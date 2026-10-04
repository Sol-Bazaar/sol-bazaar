import { handler, jsonOk, enforceRateLimit } from '@/lib/api';
import { authenticate, requireScope } from '@/lib/api-auth';
import { prisma, FulfillmentStatus } from '@solbazaar/db';
import { revealCodes } from '@solbazaar/fulfillment';
import { notFound, conflict } from '@solbazaar/core';

export const dynamic = 'force-dynamic';

export interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/orders/:id/fulfillment
 *
 * Returns the redeemable codes once they exist. Codes are stored encrypted at
 * rest and decrypted only at this boundary.
 *
 * Guard rails, because this endpoint hands over bearer value:
 *  - Requires the `fulfillment:read` scope (separate from `orders:read`), so a
 *    partner that only reads order state cannot silently drain gift cards.
 *  - Returns 409 while the order is still unpaid — the fulfillment pipeline
 *    refuses to run against an unconfirmed payment.
 *  - Codes are only decrypted for orders owned by the authenticated tenant.
 */
export const GET = handler(async (req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const auth = await authenticate(req, { required: true });
  requireScope(auth, 'fulfillment:read');
  const rateLimit = await enforceRateLimit(req, auth.apiKey?.rateLimitPerMin);

  const order = await prisma.order.findFirst({
    where: { tenantId: auth.tenant.id, OR: [{ id }, { orderNumber: id.toUpperCase() }] },
    include: {
      items: true,
      fulfillments: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) throw notFound(`Order "${id}" not found`);

  if (order.status === 'PENDING_PAYMENT' || order.status === 'EXPIRED') {
    throw conflict(`Codes are not available while the order is ${order.status}`, { status: order.status });
  }

  const delivered = order.fulfillments.filter((f) => f.status === FulfillmentStatus.DELIVERED);
  const codes = delivered.length ? await revealCodes(order.id) : [];

  return jsonOk(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.fulfillmentStatus,
      codeCount: codes.length,
      codes: codes.map((c) => ({
        code: c.code,
        pin: c.pin,
        faceValue: c.faceValue,
        currency: c.currency,
        expiresAt: c.expiresAt,
      })),
      items: order.items.map((i) => ({
        productSlug: i.productSlug,
        productName: i.productName,
        quantity: i.quantity,
      })),
      deliveredAt: delivered[0]?.deliveredAt?.toISOString() ?? null,
    },
    { req, meta: { rateLimit } },
  );
});