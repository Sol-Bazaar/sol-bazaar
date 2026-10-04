import { NextResponse } from 'next/server';
import { prisma } from '@solbazaar/db';
import { platformFeeConfig, unauthorized } from '@solbazaar/core';
import { safeCompare } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/fees
 *
 * Platform-fee accounting: what has accrued, what has been swept, and where.
 * Protect with `Authorization: Bearer $OPERATOR_TOKEN`.
 *
 * Deliberately not exposed on the tenant-scoped `/api/v1` surface — platform
 * revenue is the operator's, not any merchant's.
 */
export async function GET(req: Request) {
  const token = process.env.OPERATOR_TOKEN;
  if (!token) {
    return NextResponse.json({ error: { code: 'not_configured', message: 'OPERATOR_TOKEN is not set' } }, { status: 501 });
  }

  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!provided || !safeCompare(provided, token)) {
    throw unauthorized('Provide the operator token');
  }

  try {
    const cfg = platformFeeConfig();
    const isDevnet = process.env.SOLANA_CLUSTER !== 'mainnet-beta';

    const [totals, pending, sweeps] = await Promise.all([
      prisma.$queryRaw<
        { token: string; total: bigint; swept: bigint; cnt: number }[]
      >`
        SELECT "token",
               SUM("atomicAmount"::bigint) AS total,
               COALESCE(SUM(CASE WHEN "sweptAt" IS NOT NULL THEN "atomicAmount"::bigint ELSE 0 END), 0) AS swept,
               COUNT(*)::int AS cnt
        FROM "FeeAccrual"
        GROUP BY "token"
      `,
      prisma.$queryRaw<{ token: string; atomic: bigint; cnt: number }[]>`
        SELECT "token", SUM("atomicAmount"::bigint) AS atomic, COUNT(*)::int AS cnt
        FROM "FeeAccrual"
        WHERE "sweepId" IS NULL AND "atomicAmount" > '0'
        GROUP BY "token"
      `,
      prisma.feeSweep.findMany({
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          token: true,
          atomicAmount: true,
          usdAmount: true,
          feeCount: true,
          signature: true,
          slot: true,
          status: true,
          error: true,
          fromAddress: true,
          toAddress: true,
          createdAt: true,
          confirmedAt: true,
        },
      }),
    ]);

    return NextResponse.json(
      {
        data: {
          collector: cfg.collector,
          feeBps: cfg.bps,
          feePercent: cfg.bps / 100,
          sweepingEnabled: cfg.enabled,
          minSweepAtomic: cfg.minSweepAtomic.toString(),
          cluster: process.env.SOLANA_CLUSTER ?? 'devnet',
          totals: totals.map((t) => ({
            token: t.token,
            orderCount: t.cnt,
            totalAtomic: t.total.toString(),
            sweptAtomic: t.swept.toString(),
            unsweptAtomic: (t.total - t.swept).toString(),
          })),
          pending: pending.map((p) => ({
            token: p.token,
            atomic: p.atomic.toString(),
            orderCount: p.cnt,
          })),
          sweeps: sweeps.map((s) => ({
            ...s,
            atomicAmount: s.atomicAmount,
            usdAmount: String(s.usdAmount),
            createdAt: s.createdAt.toISOString(),
            confirmedAt: s.confirmedAt?.toISOString() ?? null,
            explorer: s.signature
              ? isDevnet
                ? `https://explorer.solana.com/tx/${s.signature}?cluster=devnet`
                : `https://solscan.io/tx/${s.signature}`
              : null,
          })),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof Error && 'code' in e) throw e;
    throw Object.assign(new Error('Failed to load fee data'), { code: 'internal' });
  }
}