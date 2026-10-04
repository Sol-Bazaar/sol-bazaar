import { PrismaClient, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { createLogger } from '@solbazaar/core';

export * from '@prisma/client';

const log = createLogger({ service: 'db' });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Next.js dev-server HMR re-evaluates modules, which would otherwise open a new
 * connection pool on every reload. Cache the client on globalThis.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.PRISMA_LOG === 'query'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

if (process.env.PRISMA_LOG === 'query') {
  (prisma as any).$on('query', (e: Prisma.QueryEvent) => {
    if (e.duration > 200) log.warn('slow_query', { ms: e.duration, query: e.query });
  });
}

/** Convert Prisma's Decimal into the shared decimal.js instance. */
export const toDec = (v: Prisma.Decimal | null | undefined) => (v == null ? null : new Decimal(v.toString()));

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Postgres advisory lock so only one worker process runs a given task at a time.
 * Used by the chain watcher (must not double-spend a nonce) and the job runner.
 */
export async function withAdvisoryLock<T>(key: string, fn: () => Promise<T>, timeoutMs = 5_000): Promise<T | null> {
  const hash = hashKey(key);
  const acquired = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT pg_try_advisory_lock(${hash}::bigint) AS ok
  `;
  if (!acquired[0]?.ok) {
    log.debug('advisory_lock_busy', { key });
    return null;
  }
  try {
    void timeoutMs;
    return await fn();
  } finally {
    await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(${hash}::bigint)`);
  }
}

/** FNV-1a 64-bit -> signed bigint, stable across processes. */
function hashKey(key: string): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < key.length; i++) {
    h ^= BigInt(key.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return BigInt.asIntN(64, h);
}

/** Wrap a transaction with retries on transient deadlock/serialization errors. */
export async function tx<T>(
  fn: (t: Prisma.TransactionClient) => Promise<T>,
  retries = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await prisma.$transaction(fn, { timeout: 15_000, maxWait: 8_000 });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : '';
      if (!/deadlock|serialization|P2034|timeout/i.test(msg) || i === retries) throw e;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i + Math.random() * 50));
    }
  }
  throw lastErr;
}