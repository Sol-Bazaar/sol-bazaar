import { handler, jsonOk, parseBody, enforceRateLimit } from '@/lib/api';
import { authenticate, requireScope } from '@/lib/api-auth';
import { createOrderSchema, clientIpFromHeaders } from '@solbazaar/core';
import { tenantToContext } from '@solbazaar/tenant';
import { createOrder } from '@/lib/orders';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/orders
 *
 * Create an order and reserve inventory. Responds with a unique on-chain deposit
 * address to pay, plus the exact amount and a lock expiry.
 *
 * Auth: `orders:write` scope.
 *
 * Idempotency: send an `Idempotency-Key` header. Repeating a request with the
 * same key returns the *original* order (including its live payment status)
 * instead of creating a second one — essential for any client that retries on
 * network errors.
 *
 * 201 -> order created (payment pending)
 * 402 -> payment required; the order exists, check GET /api/v1/orders/:id
 */
export const POST = handler(async (req: Request) => {
  const auth = await authenticate(req, { required: true });
  requireScope(auth, 'orders:write');
  const rateLimit = await enforceRateLimit(req, auth.apiKey?.rateLimitPerMin);

  const body = await parseBody(req, createOrderSchema);
  const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;

  const ip = clientIpFromHeaders(req.headers);
  const tenantCtx = tenantToContext(auth.tenant);
  // zod normalises `denomination` to a string; re-assert it so the order
  // service's contract is unambiguous.
  const parsedLines = body.lines.map((l) => ({
    productSlug: l.productSlug,
    denomination: String(l.denomination),
    quantity: l.quantity,
  }));

  const { order, quote, trackingToken, trackingUrl } = await createOrder({
    tenant: tenantCtx,
    lines: parsedLines,
    email: body.email,
    fullName: body.fullName,
    country: body.country ?? tenantCtx.defaultCountry,
    token: body.token,
    idempotencyKey,
    ip: ip ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
    referralCode: body.referralCode,
    utm: body.utm,
  });

  return jsonOk(
    {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      email: order.email,
      country: order.country,
      totals: {
        subtotalUsd: String(order.subtotalUsd),
        discountUsd: String(order.discountUsd),
        feesUsd: String(order.feesUsd),
        platformFeeUsd: String(order.platformFeeUsd),
        platformFeeBps: order.platformFeeBps,
        totalUsd: String(order.totalUsd),
      },
      payment: {
        token: quote.token,
        mint: quote.mint,
        decimals: quote.decimals,
        amountCrypto: quote.cryptoAmount,
        amountAtomic: quote.atomicAmount,
        tokenUsd: quote.tokenUsd,
        depositAddress: quote.depositAddress,
        associatedTokenAddress: quote.depositAta,
        expiresAt: quote.expiresAt,
        toleranceBps: quote.toleranceBps,
      },
      /**
       * Shareable tracking link. Returned once, at creation — only the token's
       * hash is stored, so it cannot be retrieved later. Persist it now.
       * `GET /api/v1/orders/:id` with `?email=` is the fallback route.
       */
      tracking: { url: trackingUrl, token: trackingToken },
      items: order.items.map((i) => ({
        productSlug: i.productSlug,
        productName: i.productName,
        faceValue: String(i.faceValue),
        currency: i.currency,
        quantity: i.quantity,
        lineTotalUsd: String(i.lineTotalUsd),
      })),
      createdAt: order.createdAt.toISOString(),
    },
    { status: 201, req, meta: { rateLimit, requestId: req.headers.get('x-request-id') ?? undefined } },
  );
});