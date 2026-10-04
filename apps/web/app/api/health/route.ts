import { NextResponse } from 'next/server';
import { prisma } from '@solbazaar/db';
import { createLogger } from '@solbazaar/core';

const log = createLogger({ service: 'health' });

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Liveness + readiness. Returns 503 when Postgres is unreachable so a load
 * balancer stops routing traffic to a broken instance.
 */
export async function GET() {
  const started = Date.now();
  let db = false;
  let pendingJobs = 0;
  let oldestPendingMinutes = 0;
  let delivery = { paidNotIssued: 0, issuedNotEmailed: 0, breaches: 0 };

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
    const agg = await prisma.job.aggregate({
      where: { status: 'PENDING' },
      _count: true,
      _min: { createdAt: true },
    });
    pendingJobs = agg._count;
    oldestPendingMinutes = agg._min.createdAt
      ? Math.round((Date.now() - agg._min.createdAt.getTime()) / 60_000)
      : 0;

    // Instant-delivery SLA: paid-but-undelivered is the customer-visible
    // emergency, so it degrades the health check immediately.
    const slowMs = Number(process.env.DELIVERY_SLA_MS ?? 4 * 60 * 1000);
    const cutoff = new Date(Date.now() - slowMs);
    const [paidNotIssued, issuedNotEmailed, breaches] = await Promise.all([
      prisma.order.count({ where: { status: { in: ['PAID', 'FULFILLING'] }, paidAt: { lt: cutoff } } }),
      prisma.order.count({ where: { status: 'COMPLETED', emailSentAt: null, updatedAt: { lt: cutoff } } }),
      prisma.order.count({ where: { status: 'COMPLETED', deliveryLatencyMs: { gt: slowMs } } }),
    ]);
    delivery = { paidNotIssued, issuedNotEmailed, breaches };
  } catch (e) {
    log.error('health_db_unreachable', { err: (e as Error).message });
  }

  // Degraded when the queue is lagging OR a customer has paid and not received
  // their codes. Both are load-balancer-worthy signals.
  const degraded = db && (oldestPendingMinutes > 10 || delivery.paidNotIssued > 0 || delivery.issuedNotEmailed > 0);

  return NextResponse.json(
    {
      status: !db ? 'down' : degraded ? 'degraded' : 'ok',
      db,
      cluster: process.env.SOLANA_CLUSTER ?? 'devnet',
      pendingJobs,
      oldestPendingMinutes,
      deliverySla: {
        thresholdMs: Number(process.env.DELIVERY_SLA_MS ?? 4 * 60 * 1000),
        paidNotIssued: delivery.paidNotIssued,
        issuedNotEmailed: delivery.issuedNotEmailed,
        slowDeliveries: delivery.breaches,
      },
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    },
    { status: db ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}