/**
 * Worker entrypoint.
 *
 * Runs three cooperating loops in one process:
 *
 *   1. **Job runner**   — executes FULFILL_ORDER, email, webhook, expiry, …
 *   2. **Chain watcher** — detects Solana payments on order deposit addresses.
 *   3. **Maintenance**   — expiry sweeps, webhook flushes, issuer polling,
 *                         stuck-order detection, price refresh.
 *
 * Splitting these across processes is a config change, not a code change: run
 * `WORKER_ROLES=watcher`, `WORKER_ROLES=jobs` or `WORKER_ROLES=maintenance`
 * on separate instances and scale them independently. The watcher is the
 * latency-critical one (it gates how fast a customer gets their card); the job
 * runner is the throughput-critical one.
 *
 * PostgreSQL advisory locks make horizontal scaling safe: if you accidentally
 * start two watchers, the second one logs and exits instead of double-processing.
 */
import 'dotenv/config';
import { prisma, JobType } from '@solbazaar/db';
import { JobRunner } from '@solbazaar/jobs';
import { bootstrapProviders } from '@solbazaar/provider';
import { fulfillOrder, deliverOrderEmail, publish } from '@solbazaar/fulfillment';
import { createLogger, normaliseError, platformFeeConfig } from '@solbazaar/core';
import { PaymentWatcher } from './watcher';
import { startMaintenance, refreshTokenPrices, sweepExpiredOrders, checkDeliverySla } from './maintenance';
import { accruePlatformFee, reversePlatformFee } from './fees';
import { sweepPlatformFees, feeTotals, pendingFeeBalances } from './fee-sweeper';

const log = createLogger({ service: 'worker', instance: process.env.INSTANCE_ID ?? `pid-${process.pid}` });

type Role = 'jobs' | 'watcher' | 'maintenance' | 'fees';

const ALL_ROLES: Role[] = ['jobs', 'watcher', 'maintenance', 'fees'];

function rolesFromEnv(): Role[] {
  const raw = process.env.WORKER_ROLES;
  if (!raw) return ALL_ROLES;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as Role[];
  return list.length ? list : ALL_ROLES;
}

/**
 * Advisory lock, session-scoped: exactly one instance of each role runs, and a
 * crashed process releases its lock automatically (no stale-lock cleanup).
 *
 * Returns a release function instead of wrapping the role body. That matters —
 * the role bodies are *infinite loops*, so awaiting them would block boot
 * forever and every subsequent role would silently never start. (It did, once.)
 */
async function acquireLock(key: string): Promise<(() => Promise<void>) | null> {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtext(${key})::bigint) AS locked
  `;
  if (!rows[0]?.locked) {
    log.warn('role_already_running_elsewhere', { role: key, action: 'skipping' });
    return null;
  }
  log.info('role_acquired', { role: key });

  return async () => {
    try {
      await prisma.$executeRaw`
        SELECT pg_advisory_unlock(hashtext(${key})::bigint)
      `;
    } catch (e) {
      log.warn('role_unlock_failed', { role: key, err: (e as Error).message });
    }
  };
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

function buildRunner(): JobRunner {
  const runner = new JobRunner({
    workerId: process.env.INSTANCE_ID ?? `w-${process.pid}`,
    concurrency: Number(process.env.JOB_CONCURRENCY ?? 4),
    pollIntervalMs: Number(process.env.JOB_POLL_MS ?? 1500),
  });

  /**
   * Issue the gift card, then book our platform fee.
   *
   * Order matters: the fee is only accrued once codes are actually delivered,
   * so a failed issuer call leaves no phantom revenue behind.
   *
   * Throwing here is *good* for provider errors: the runner records the error
   * and retries with backoff, and the order stays PAID rather than being
   * silently marked failed on a transient issuer outage. Fee accrual errors,
   * by contrast, are swallowed — the card has already been issued, and a
   * bookkeeping problem must not cause the job to re-buy a second set of codes.
   */
  runner.register(JobType.FULFILL_ORDER, async (payload: { orderId: string }) => {
    const outcome = await fulfillOrder(payload.orderId);

    if (outcome.status === 'DELIVERED') {
      try {
        await accruePlatformFee(payload.orderId);
      } catch (e) {
        log.error('fee_accrual_failed', { orderId: payload.orderId, err: (e as Error).message });
      }
    } else {
      // Failed fulfilment -> no fee. Clears any row from a prior attempt.
      await reversePlatformFee(payload.orderId, outcome.failureReason ?? 'fulfillment_failed').catch(() => undefined);
    }

    // Partner webhook once codes are actually in hand.
    await publish('order.fulfilled', { orderId: payload.orderId });
  });

  runner.register(JobType.DELIVER_ORDER_EMAIL, async (payload: { orderId: string }) => {
    await deliverOrderEmail(payload.orderId);
  });

  runner.register(JobType.EXPIRE_ORDER, async (payload: { orderId: string }) => {
    await sweepExpiredOrders();
    void payload;
  });

  runner.register(JobType.RELEASE_STOCK, async (payload: { orderId: string }) => {
    await sweepExpiredOrders();
    void payload;
  });

  runner.register(JobType.SYNC_PRICES, async () => {
    await refreshTokenPrices();
  });

  runner.register(JobType.SYNC_INVENTORY, async () => {
    await prisma.product.updateMany({ data: { updatedAt: new Date() } });
  });

  /**
   * Publish a partner webhook. Kept as a job (rather than an inline call) so a
   * slow or dead partner endpoint can never delay gift card issuance.
   */
  runner.register(JobType.SEND_WEBHOOK, async (payload: { orderId: string; event: string }) => {
    const { prisma: db } = await import('@solbazaar/db');
    const order = await db.order.findUnique({
      where: { id: payload.orderId },
      include: { items: true },
    });
    if (!order) return;
    await publish(payload.event as any, {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      totalUsd: String(order.totalUsd),
      token: order.token,
      items: order.items.map((i) => ({
        productSlug: i.productSlug,
        productName: i.productName,
        faceValue: String(i.faceValue),
        quantity: i.quantity,
      })),
      paidAt: order.paidAt?.toISOString() ?? null,
      updatedAt: order.updatedAt.toISOString(),
    });
  });

  runner.register(JobType.REFUND_ORDER, async (payload: { orderId: string }) => {
    // Automatic refunds are intentionally a no-op placeholder: moving
    // irreversible crypto requires a deliberate, audited action. See
    // docs/OPERATIONS.md#refunds for the manual runbook.
    log.warn('refund_requested_manual_action_required', payload);
  });

  /**
   * Move accumulated platform fees to the collector wallet.
   *
   * `dedupeKey` is time-bucketed so repeated enqueues inside the same window
   * collapse into one sweep — several orders completing at once must not queue
   * a sweep per order.
   */
  runner.register(JobType.SWEEP_FEES, async () => {
    const results = await sweepPlatformFees();
    const swept = results.filter((r) => r.swept);
    if (swept.length) {
      log.info('fee_sweep_batch_done', {
        swept: swept.map((s) => ({ token: s.token, amount: s.atomicAmount, fees: s.feeCount })),
      });
    }
    const failed = results.filter((r) => !r.swept && r.reason !== 'below_threshold' && r.reason !== 'nothing_pending');
    if (failed.length) {
      throw new Error(`fee sweep incomplete: ${failed.map((f) => `${f.token}:${f.reason}`).join(', ')}`);
    }
  });

  return runner;
}

/**
 * Fee-sweep loop.
 *
 * Runs on its own cadence rather than per-order: batching many fees into one
 * transaction means one signature fee instead of hundreds, and Solana's native
 * fee (5000 lamports) is negligible against a 1% take on a gift card.
 */
async function runFeeSweeper(intervalMs: number): Promise<void> {
  log.info('fee_sweeper_started', { intervalMs, collector: platformFeeConfig().collector });
  for (;;) {
    try {
      await sweepPlatformFees();
    } catch (e) {
      log.error('fee_sweeper_iteration_failed', { err: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  const roles = rolesFromEnv();
  log.info('worker_boot', {
    roles,
    cluster: process.env.SOLANA_CLUSTER ?? 'devnet',
    providerConfigured: Boolean(process.env.RECHARGE_API_KEY),
  });

  bootstrapProviders();
  await JobRunner.reapStale();

  // Prime the price board before accepting traffic.
  await refreshTokenPrices();

  const stops: Array<() => void | Promise<void>> = [];

  /*
   * Every role body is an infinite loop, so each is started with `void` rather
   * than awaited. Only the lock acquisition is awaited. Awaiting any loop here
   * would block boot and silently leave the remaining roles dead — which is how
   * the chain watcher ended up never starting in an earlier build.
   */
  if (roles.includes('jobs')) {
    const runner = buildRunner();
    const release = await acquireLock('solbazaar:jobs');
    if (release) {
      stops.push(runner.stop, release);
      void runner.start();
    }
  }

  if (roles.includes('watcher')) {
    const watcher = new PaymentWatcher();
    const release = await acquireLock('solbazaar:watcher');
    if (release) {
      stops.push(watcher.stop, release);
      void watcher.start();
    }
  }

  if (roles.includes('maintenance')) {
    const release = await acquireLock('solbazaar:maintenance');
    if (release) {
      const stop = await startMaintenance(Number(process.env.MAINTENANCE_INTERVAL_MS ?? 60_000));
      stops.push(stop, release);
    }
  }

  if (roles.includes('fees')) {
    const release = await acquireLock('solbazaar:fees');
    if (release) {
      stops.push(release);
      void runFeeSweeper(Number(process.env.FEE_SWEEP_INTERVAL_MS ?? 900_000));
    }
  }

  log.info('worker_ready', {
    roles,
    started: roles.filter((r) => !['jobs', 'watcher', 'maintenance', 'fees'].includes(r)),
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutdown_requested', { signal });
    for (const stop of stops) {
      try {
        await stop();
      } catch {
        /* best effort */
      }
    }
    // Let in-flight jobs finish, then close the DB pool.
    setTimeout(async () => {
      try {
        await prisma.$disconnect();
      } catch (e) {
        log.error('disconnect_failed', normaliseError(e) as any);
      }
      log.info('shutdown_complete');
      process.exit(0);
    }, Number(process.env.SHUTDOWN_GRACE_MS ?? 8000));
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled_rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (err) => {
    // An uncaught exception leaves the process in an unknown state. Log, then
    // exit non-zero so the supervisor restarts us cleanly.
    log.error('uncaught_exception', { err: err.message, stack: err.stack?.split('\n').slice(0, 6).join(' | ') });
    process.exit(1);
  });
}

main().catch((e) => {
  log.error('worker_fatal', { err: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});

export { buildRunner, main, runFeeSweeper, feeTotals, pendingFeeBalances };