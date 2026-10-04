import { handler, jsonOk } from '@/lib/api';
import { prisma } from '@solbazaar/db';
import { bootstrapProviders, getProvider } from '@solbazaar/provider';
import { applyProviderWebhook } from '@solbazaar/fulfillment';
import { enqueue } from '@solbazaar/jobs';
import { badRequest, createLogger } from '@solbazaar/core';

const log = createLogger({ service: 'api:issuer-webhook' });

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/issuer/:provider
 *
 * Inbound webhook from the gift-card issuer (Recharge, etc.).
 *
 * The provider is identified by the last URL segment and, when a base URL is
 * configured, by matching that URL. Signature verification happens inside each
 * provider adapter using the raw body — which is why we read `req.text()` and
 * never `req.json()` before verifying.
 *
 * Configure the issuer's webhook target as:
 *   https://<tenant-domain>/api/v1/webhooks/issuer/recharge
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ provider: string }> }) => {
  const { provider } = await ctx.params;
  bootstrapProviders();

  const raw = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let p;
  try {
    p = getProvider(provider);
  } catch {
    throw badRequest(`Unknown provider "${provider}"`);
  }

  // Providers without inbound webhooks (the sandbox) should never be called.
  if (!p.supportsWebhook) throw badRequest(`Provider "${provider}" does not send webhooks`);

  const parser = (p as unknown as { parseWebhook?: (b: string, h: Record<string, string>) => any }).parseWebhook;
  if (typeof parser !== 'function') throw badRequest(`Provider "${provider}" cannot verify webhooks`);

  const event = parser(raw, headers);

  const applied = await applyProviderWebhook({
    providerKey: provider,
    externalId: event.externalId,
    status: event.status,
    codes: event.codes,
  });

  if (applied.applied && event.status === 'DELIVERED' && event.codes.length) {
    // Deliver to the customer + fan out to partner webhooks.
    const fulfillment = await prisma.fulfillment.findUnique({
      where: { externalId: event.externalId },
      select: { orderId: true },
    });
    if (fulfillment) {
      await enqueue('DELIVER_ORDER_EMAIL', { orderId: fulfillment.orderId }, { dedupeKey: `deliver:${fulfillment.orderId}` });
      await enqueue('SEND_WEBHOOK', { orderId: fulfillment.orderId, event: 'order.fulfilled' }, { dedupeKey: `wh:ff:${fulfillment.orderId}` });
    }
  }

  log.info('issuer_webhook', { provider, externalId: event.externalId, status: event.status, applied: applied.reason ?? 'yes' });

  // Always 2xx once verified: returning an error makes the issuer retry forever.
  return jsonOk({ received: true, applied: applied.applied, reason: applied.reason ?? null });
});