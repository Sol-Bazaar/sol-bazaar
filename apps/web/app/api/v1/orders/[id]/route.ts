import { handler, jsonOk, enforceRateLimit } from '@/lib/api';
import { authenticate, requireScope } from '@/lib/api-auth';
import { prisma } from '@solbazaar/db';
import { formatCrypto, notFound, requiredAtomic } from '@solbazaar/core';

export const dynamic = 'force-dynamic';

export interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/orders/:id
 *
 * Live payment + fulfilment status. Accepts either our internal id or the
 * human `orderNumber` (FC-XXXXXX), so a partner can surface a reference the
 * customer reads over the phone.
 *
 * `receivedAtomic` / `requiredAtomic` let a partner build their own
 * "waiting for payment" UI without re-deriving the tolerance rules.
 *
 * Auth: `orders:read`.
 */
export const GET = handler(async (req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const auth = await authenticate(req, { required: true });
  requireScope(auth, 'orders:read');
  const rateLimit = await enforceRateLimit(req, auth.apiKey?.rateLimitPerMin);

  const order = await prisma.order.findFirst({
    where: {
      tenantId: auth.tenant.id,
      OR: [{ id }, { orderNumber: id.toUpperCase() }],
    },
    include: {
      items: true,
      txs: { orderBy: { seenAt: 'desc' }, take: 10 },
      fulfillments: { select: { id: true, provider: true, externalId: true, status: true, codeCount: true, failureReason: true, deliveredAt: true } },
    },
  });

  if (!order) throw notFound(`Order "${id}" not found`);

  const required = requiredAtomic(BigInt(order.expectedAtomic), order.toleranceBps);
  const received = BigInt(order.receivedAtomic);

  return jsonOk(
    {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      email: order.email,
      country: order.country,
      totals: {
        subtotalUsd: String(order.subtotalUsd),
        discountUsd: String(order.discountUsd),
        feesUsd: String(order.feesUsd),
        totalUsd: String(order.totalUsd),
      },
      payment: {
        token: order.token,
        mint: order.mintAddress,
        decimals: order.tokenDecimals,
        amountCrypto: formatCrypto(String(order.amountCrypto), order.tokenDecimals, 9),
        amountAtomic: order.amountAtomic,
        requiredAtomic: required.toString(),
        receivedAtomic: order.receivedAtomic,
        paid: order.receivedAtomic !== '0',
        paidAt: order.paidAt?.toISOString() ?? null,
        confirmations: order.confirmations,
        depositAddress: order.depositAddress,
        associatedTokenAddress: order.depositAta,
        expiresAt: order.expiresAt.toISOString(),
        expired: order.expiresAt < new Date() && order.status === 'PENDING_PAYMENT',
        transactionCount: order.paymentTxCount,
        underpaidUsd: order.underpaidUsd ? String(order.underpaidUsd) : null,
        overpaidUsd: order.overpaidUsd ? String(order.overpaidUsd) : null,
      },
      fulfillment: order.fulfillments,
      failureReason: order.failureReason,
      items: order.items.map((i) => ({
        productSlug: i.productSlug,
        productName: i.productName,
        faceValue: String(i.faceValue),
        currency: i.currency,
        quantity: i.quantity,
        lineTotalUsd: String(i.lineTotalUsd),
      })),
      transactions: order.txs.map((t) => ({
        signature: t.signature,
        slot: t.slot,
        amountAtomic: t.atomicAmount,
        confirmations: t.confirmations,
        finalized: t.finalized,
        seenAt: t.seenAt.toISOString(),
      })),
      createdAt: order.createdAt.toISOString(),
    },
    { req, meta: { rateLimit } },
  );
});