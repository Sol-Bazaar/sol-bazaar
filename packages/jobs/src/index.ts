/**
 * Postgres-backed job queue.
 *
 * Why not Redis/BullMQ: one fewer moving part, and every enqueue happens inside
 * the same transaction as the state change that caused it (the transactional
 * outbox pattern). If the process crashes mid-transaction, the job is simply
 * never created — and the state change rolls back with it, so we can never end
 * up "paid but never fulfilled".
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, which is exactly what makes this safe
 * to run on N workers: each row is handed to exactly one of them.
 *
 * Scaling note: at higher throughput, swap the claim loop for `LISTEN/NOTIFY` so
 * workers wake immediately instead of polling. The claim SQL itself does not
 * change.
 */
import { randomUUID } from 'node:crypto';
import { prisma, JobStatus, JobType, type Job, Prisma } from '@solbazaar/db';
import { createLogger, sleep } from '@solbazaar/core';

const log = createLogger({ service: 'jobs' });

export interface EnqueueOpts {
  /** Unique key — a second enqueue with the same key is a no-op. */
  dedupeKey?: string;
  priority?: number; // lower runs first
  runAt?: Date;
  maxAttempts?: number;
}

// Backoff schedule (seconds) for the Nth attempt.
const BACKOFF_SECONDS = [0, 15, 45, 120, 300, 900, 1800, 3600];

export async function enqueue(type: JobType, payload: Record<string, unknown> = {}, opts: EnqueueOpts = {}) {
  const data: Prisma.JobUncheckedCreateInput = {
    type,
    payload: payload as Prisma.InputJsonValue,
    priority: opts.priority ?? (PRIORITY[type] ?? 100),
    runAt: opts.runAt ?? new Date(),
    maxAttempts: opts.maxAttempts ?? 8,
    ...(opts.dedupeKey ? { dedupeKey: opts.dedupeKey } : {}),
  };
  return prisma.job.upsert({
    where: { dedupeKey: opts.dedupeKey ?? `__none__${randomUUID()}` },
    create: data,
    update: {}, // dedupeKey already queued -> leave the existing job alone
  });
}

/**
 * Force a job to run again, resetting its retry state.
 *
 * `enqueue` is a no-op when a row with the same `dedupeKey` already exists —
 * which is correct for "don't queue this twice", but wrong for "please retry
 * this now": a job that exhausted its attempts is DEAD, and enqueueing it again
 * silently does nothing. That failure is invisible, so recovery must be explicit.
 *
 * Used by the delivery-SLA monitor to re-drive fulfilment for a paid order whose
 * job died.
 */
export async function requeue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: { dedupeKey: string; priority?: number; maxAttempts?: number } ,
): Promise<boolean> {
  const data = {
    type,
    payload: payload as Prisma.InputJsonValue,
    status: JobStatus.PENDING,
    priority: opts.priority ?? (PRIORITY[type] ?? 100),
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 8,
    runAt: new Date(),
    lastError: null,
    lockedAt: null,
    lockedBy: null,
  };

  const result = await prisma.job.upsert({
    where: { dedupeKey: opts.dedupeKey },
    create: { ...data, dedupeKey: opts.dedupeKey },
    update: data,
    select: { attempts: true, status: true },
  });

  return result.status === JobStatus.PENDING;
}

const PRIORITY: Partial<Record<JobType, number>> = {
  FULFILL_ORDER: 1, // customer is staring at the screen
  DELIVER_ORDER_EMAIL: 2,
  REFUND_ORDER: 5,
  SWEEP_FEES: 10, // revenue collection, batched
  SEND_WEBHOOK: 20,
  EXPIRE_ORDER: 30,
  RELEASE_STOCK: 30,
  SYNC_PRICES: 50,
  SYNC_INVENTORY: 60,
};

export type JobHandler = (payload: any, job: Job) => Promise<void> | void;

export interface RunnerOptions {
  workerId?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  /** Types this worker should handle (undefined = all). */
  handles?: JobType[];
  batchSize?: number;
}

export class JobRunner {
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly handles: Set<JobType> | null;
  private readonly batchSize: number;
  private readonly handlers = new Map<JobType, JobHandler>();
  private running = false;
  private inFlight = 0;

  constructor(opts: RunnerOptions = {}) {
    this.workerId = opts.workerId ?? `w-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.concurrency = opts.concurrency ?? Number(process.env.JOB_CONCURRENCY ?? 4);
    this.pollIntervalMs = opts.pollIntervalMs ?? Number(process.env.JOB_POLL_MS ?? 2000);
    this.handles = opts.handles ? new Set(opts.handles) : null;
    this.batchSize = opts.batchSize ?? Math.max(1, this.concurrency);
    log.info('runner_config', {
      workerId: this.workerId,
      concurrency: this.concurrency,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  register(type: JobType, handler: JobHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  async start(): Promise<void> {
    this.running = true;
    log.info('runner_started', { workerId: this.workerId });
    while (this.running) {
      try {
        const free = this.concurrency - this.inFlight;
        if (free > 0) {
          const jobs = await this.claim(Math.min(this.batchSize, free));
          for (const job of jobs) {
            this.inFlight++;
            void this.execute(job).finally(() => {
              this.inFlight--;
            });
          }
        }
      } catch (e) {
        log.error('runner_poll_failed', { err: (e as Error).message });
      }
      await sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
    log.info('runner_stopping', { workerId: this.workerId });
  }

  /** Claim up to `n` due jobs, atomically locking them for this worker. */
  private async claim(n: number): Promise<Job[]> {
    const types = this.handles ? [...this.handles] : undefined;
    return prisma.$queryRaw<Job[]>`
      WITH picked AS (
        SELECT id FROM "Job"
        WHERE status = 'PENDING'
          AND "runAt" <= now()
          ${types?.length ? Prisma.join(types.map((t) => Prisma.sql`${t}::"JobType"`)) : Prisma.empty}
        ORDER BY priority ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${n}
      )
      UPDATE "Job" j
      SET status = 'RUNNING',
          "lockedAt" = now(),
          "lockedBy" = ${this.workerId},
          attempts = j.attempts + 1,
          "updatedAt" = now()
      FROM picked
      WHERE j.id = picked.id
      RETURNING j.*
    `;
  }

  private async execute(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      log.error('no_handler', { type: job.type });
      await this.fail(job, `No handler registered for ${job.type}`, true);
      return;
    }

    const started = Date.now();
    try {
      await handler(job.payload, job);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: JobStatus.COMPLETED, lockedAt: null, lockedBy: null, lastError: null },
      });
      log.info('job_done', { id: job.id, type: job.type, ms: Date.now() - started });
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      await this.fail(job, message, false);
    }
  }

  private async fail(job: Job, message: string, fatal: boolean): Promise<void> {
    const exhausted = fatal || job.attempts >= job.maxAttempts;
    const delay = BACKOFF_SECONDS[Math.min(job.attempts, BACKOFF_SECONDS.length - 1)] ?? 3600;

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: exhausted ? JobStatus.DEAD : JobStatus.PENDING,
        runAt: new Date(Date.now() + delay * 1000),
        lockedAt: null,
        lockedBy: null,
        lastError: message.slice(0, 4000),
      },
    });

    log[exhausted ? 'error' : 'warn']('job_failed', {
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      exhausted,
      err: message.slice(0, 300),
    });
  }

  /** Requeue jobs stranded by a crash (RUNNING with a stale lock). */
  static async reapStale(olderThanSeconds = 300): Promise<number> {
    const res = await prisma.job.updateMany({
      where: {
        status: JobStatus.RUNNING,
        lockedAt: { lt: new Date(Date.now() - olderThanSeconds * 1000) },
      },
      data: { status: JobStatus.PENDING, lockedAt: null, lockedBy: null },
    });
    if (res.count) log.warn('reaped_stale_jobs', { count: res.count });
    return res.count;
  }
}

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

/** Recurring job: enqueue one run now; the handler re-enqueues itself. */
export async function enqueueRecurring(
  type: JobType,
  everyMs: number,
  payload: Record<string, unknown> = {},
  dedupeKey = `${type}:tick`,
): Promise<void> {
  await enqueue(type, payload, {
    dedupeKey: `${dedupeKey}:${Math.floor(Date.now() / everyMs)}`,
    runAt: new Date(Date.now() + everyMs),
    priority: PRIORITY[type] ?? 100,
  });
}

export const JOB_TYPES = JobType;
export const JOB_STATUS = JobStatus;