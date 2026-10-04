/**
 * Platform-fee accrual.
 *
 * Called once per order when fulfilment completes successfully. Writing the
 * accrual at *delivery* time (not at order creation) means we never book revenue
 * for an order that failed to issue, and an unpaid or expired order accrues
 * nothing at all.
 *
 * Idempotency: `FeeAccrual.orderId` is UNIQUE and we use `upsert`, so a retried
 * fulfilment updates the existing row instead of booking the fee again.
 */
import { prisma, OrderStatus } from '@solbazaar/db';
import { platformFeeConfig, createLogger, splitAtomicFee } from '@solbazaar/core';
import type { TokenSymbol } from '@solbazaar/db';

const log = createLogger({ service: 'fees' });

export interface AccrualResult {
  accrued: boolean;
  atomicAmount: string;
  reason?: string;
}

export async function accruePlatformFee(orderId: string): Promise<AccrualResult> {
  const cfg = platformFeeConfig();
  if (!cfg.enabled || cfg.bps <= 0) {
    return { accrued: false, atomicAmount: '0', reason: 'fee_disabled' };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      token: true,
      tokenDecimals: true,
      mintAddress: true,
      amountAtomic: true,
      expectedAtomic: true,
      platformFeeAtomic: true,
      platformFeeUsd: true,
      platformFeeBps: true,
      receivedAtomic: true,
    },
  });

  if (!order) return { accrued: false, atomicAmount: '0', reason: 'order_not_found' };

  // Only a genuinely delivered order earns a fee.
  if (order.status !== OrderStatus.COMPLETED) {
    log.debug('fee_not_accrued', { orderId, status: order.status, reason: 'order_not_completed' });
    return { accrued: false, atomicAmount: '0', reason: `order_${order.status.toLowerCase()}` };
  }

  // Prefer the value snapshotted at checkout; recompute only if it is missing
  // (an order created before the fee existed).
  let atomic = BigInt(order.platformFeeAtomic || '0');
  if (atomic === 0n) {
    atomic = splitAtomicFee(BigInt(order.expectedAtomic), order.platformFeeBps || cfg.bps).platformFeeAtomic;
  }
  if (atomic <= 0n) return { accrued: false, atomicAmount: '0', reason: 'zero_fee' };

  await prisma.feeAccrual.upsert({
    where: { orderId },
    create: {
      orderId,
      token: order.token as TokenSymbol,
      mint: order.mintAddress,
      decimals: order.tokenDecimals,
      atomicAmount: atomic.toString(),
      usdAmount: order.platformFeeUsd,
      feeBps: order.platformFeeBps || cfg.bps,
      collector: cfg.collector,
    },
    // If the row already exists and has been swept, do not un-sweep it.
    update: { atomicAmount: atomic.toString(), usdAmount: order.platformFeeUsd },
  });

  log.info('fee_accrued', {
    orderId,
    // Named `tokenSymbol` rather than `token` so the logger's secret-redaction
    // rule (which matches a bare `token` key, since that is usually a bearer
    // credential) does not hide it.
    tokenSymbol: order.token,
    atomic: atomic.toString(),
    collector: cfg.collector,
  });

  return { accrued: true, atomicAmount: atomic.toString() };
}

/** Remove any accrual for an order that did not end up delivered. */
export async function reversePlatformFee(orderId: string, reason: string): Promise<void> {
  const res = await prisma.feeAccrual.deleteMany({
    where: { orderId, sweptAt: null }, // never delete already-swept revenue
  });
  if (res.count) log.info('fee_reversed', { orderId, reason, rows: res.count });
}

/** Accounting snapshot for the operator dashboard / API. */
export async function feeSummary() {
  const [pending, totals, recentSweeps] = await Promise.all([
    prisma.$queryRaw<{ token: string; atomic: bigint; cnt: number }[]>`
      SELECT "token", SUM("atomicAmount"::bigint) AS atomic, COUNT(*)::int AS cnt
      FROM "FeeAccrual"
      WHERE "sweepId" IS NULL AND "atomicAmount" > '0'
      GROUP BY "token"
    `,
    prisma.feeAccrual.aggregate({ _count: true, _sum: { usdAmount: true } }),
    prisma.feeSweep.findMany({
      where: { status: 'CONFIRMED' },
      orderBy: { confirmedAt: 'desc' },
      take: 20,
      select: { id: true, token: true, atomicAmount: true, signature: true, confirmedAt: true, feeCount: true, usdAmount: true },
    }),
  ]);

  return {
    collector: platformFeeConfig().collector,
    feeBps: platformFeeConfig().bps,
    accrualCount: totals._count,
    lifetimeUsd: totals._sum.usdAmount ? String(totals._sum.usdAmount) : '0',
    pendingByToken: pending.map((p) => ({ token: p.token as TokenSymbol, atomic: p.atomic.toString(), orderCount: p.cnt })),
    recentSweeps: recentSweeps.map((s) => ({
      id: s.id,
      token: s.token,
      atomicAmount: s.atomicAmount,
      signature: s.signature,
      feeCount: s.feeCount,
      usdAmount: String(s.usdAmount),
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
    })),
  };
}