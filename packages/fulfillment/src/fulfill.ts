/**
 * Fulfillment orchestration.
 *
 * Invariants this module exists to protect:
 *
 *  1. **A code is only ever issued for a confirmed payment.** `fulfillOrder`
 *     refuses to run unless `Order.status` is PAID (or already FULFILLING).
 *     There is no code path from PENDING_PAYMENT to a provider call.
 *
 *  2. **Fulfillment happens exactly once per order item.** Provider calls are
 *     idempotent on `Order.id` (Recharge via an Idempotency-Key header, the
 *     sandbox via an in-memory map) *and* `Fulfillment.externalId` is UNIQUE in
 *     Postgres. A double-delivery would double-charge the issuer, so this is
 *     guarded at both layers.
 *
 *  3. **Stock is debited exactly once.** Reservation happens at order
 *     creation; consumption happens on successful delivery, in the same
 *     transaction that writes the codes.
 *
 *  4. **Codes are never stored in plaintext** (see crypto-box.ts).
 */
import Decimal from 'decimal.js';
import { prisma, FulfillmentStatus, OrderStatus } from '@solbazaar/db';
import { getProvider, bootstrapProviders } from '@solbazaar/provider';
import type { ProviderOrderLine, ProviderCode } from '@solbazaar/provider';
import { createLogger, badRequest, conflict, notFound } from '@solbazaar/core';
import { encryptCodes, decryptCodes, maskCode, type StoredCode } from './crypto-box';

const log = createLogger({ service: 'fulfillment' });

/**
 * Providers are bootstrapped lazily as well as at worker boot, so a script that
 * imports only this module still works. `bootstrapProviders` is idempotent, so
 * calling it on every fulfilment is safe (and picks up config changes).
 */
function ensureProviders() {
  bootstrapProviders();
}

export interface FulfillmentOutcome {
  orderId: string;
  status: 'DELIVERED' | 'PROCESSING' | 'FAILED';
  externalId?: string;
  codeCount: number;
  failureReason?: string;
}

/**
 * Place the issuer order for a paid order and persist the codes.
 * Idempotent — safe to call repeatedly.
 */
export async function fulfillOrder(orderId: string): Promise<FulfillmentOutcome> {
  ensureProviders();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { include: { denominations: true } } } },
      fulfillments: true,
      tenant: { select: { id: true, slug: true } },
    },
  });

  if (!order) throw notFound(`Order ${orderId} not found`);

  // INVARIANT 1 — never issue against an unconfirmed payment.
  if (order.status === OrderStatus.PENDING_PAYMENT) {
    throw conflict(`Order ${order.orderNumber} is not paid yet; refusing to fulfill`);
  }
  if (order.status === OrderStatus.EXPIRED || order.status === OrderStatus.CANCELLED) {
    throw conflict(`Order ${order.orderNumber} is ${order.status}; refusing to fulfill`);
  }

  const alreadyDelivered = order.fulfillments.filter((f) => f.status === FulfillmentStatus.DELIVERED);
  if (alreadyDelivered.length) {
    return {
      orderId,
      status: 'DELIVERED',
      externalId: alreadyDelivered[0].externalId ?? undefined,
      codeCount: alreadyDelivered.reduce((a, f) => a + f.codeCount, 0),
    };
  }

  // Group identical (product, denomination) pairs into one provider line.
  const lineMap = new Map<string, ProviderOrderLine>();
  for (const item of order.items) {
    const key = `${item.productId}:${item.faceValue.toString()}:${item.currency}`;
    const denom = item.product.denominations.find(
      (dn) => new Decimal(dn.faceValue.toString()).eq(new Decimal(item.faceValue.toString())) && dn.currency === item.currency,
    );
    const existing = lineMap.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      lineMap.set(key, {
        externalId: item.product.externalId ?? item.productId,
        ...(denom?.providerSku ? { sku: denom.providerSku } : {}),
        faceValue: new Decimal(item.faceValue.toString()),
        currency: item.currency,
        quantity: item.quantity,
      });
    }
  }
  const lines = [...lineMap.values()];
  if (!lines.length) throw badRequest('Order has no fulfilable lines');

  // All items must resolve to the same provider; otherwise the inventory layer
  // has let a mixed cart through.
  const providerKeys = new Set(order.items.map((i) => i.product.provider));
  if (providerKeys.size > 1) {
    throw conflict(`Mixed providers in one order: ${[...providerKeys].join(', ')}. Split the cart.`);
  }
  const provider = getProvider(order.items[0].product.provider);

  // Claim the order so two workers cannot both call the provider.
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: OrderStatus.PAID },
    data: { status: OrderStatus.FULFILLING, fulfillmentStatus: FulfillmentStatus.PROCESSING },
  });
  if (claimed.count === 0 && order.status !== OrderStatus.FULFILLING) {
    throw conflict(`Order ${order.orderNumber} could not be claimed for fulfilment`);
  }

  let result;
  try {
    result = await provider.createOrder({
      orderId: order.id,
      orderNumber: order.orderNumber,
      email: order.email,
      fullName: order.fullName ?? undefined,
      country: order.country,
      lines,
    });
  } catch (e) {
    // Release the claim so the retry can pick it up.
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAID, fulfillmentStatus: FulfillmentStatus.PENDING, failureReason: (e as Error).message.slice(0, 500) },
    });
    throw e;
  }

  const codes: StoredCode[] = result.codes.map((c: ProviderCode) => ({
    code: c.code,
    pin: c.pin ?? null,
    faceValue: c.faceValue ? c.faceValue.toFixed(2) : null,
    currency: c.currency ?? null,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
  }));

  if (result.status === 'FAILED' || (result.status !== 'DELIVERED' && codes.length === 0 && !result.pollable)) {
    const reason = result.failureReason ?? 'issuer_rejected';
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FAILED, failureReason: reason, fulfillmentStatus: FulfillmentStatus.FAILED },
    });
    await upsertFulfillment({
      orderId,
      provider: provider.key,
      externalId: result.externalId,
      status: FulfillmentStatus.FAILED,
      failureReason: reason,
      providerRaw: result.raw as Record<string, unknown>,
    });
    log.error('fulfillment_failed', { orderId, reason, externalId: result.externalId });
    return { orderId, status: 'FAILED', externalId: result.externalId, codeCount: 0, failureReason: reason };
  }

  if (result.status === 'DELIVERED' && codes.length === 0) {
    // Issuer said delivered but gave us nothing — treat as a hard failure
    // rather than marking an empty order complete.
    const reason = 'issuer_returned_no_codes';
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FAILED, failureReason: reason },
    });
    log.error('fulfillment_empty', { orderId, externalId: result.externalId });
    return { orderId, status: 'FAILED', externalId: result.externalId, codeCount: 0, failureReason: reason };
  }

  // INVARIANT 3 + 4 — write codes and consume stock atomically.
  await prisma.$transaction(async (t) => {
    await upsertFulfillment(
      {
        orderId,
        provider: provider.key,
        externalId: result.externalId,
        status: codes.length ? FulfillmentStatus.DELIVERED : FulfillmentStatus.PROCESSING,
        codesCipher: codes.length ? encryptCodes(codes) : null,
        codeCount: codes.length,
        faceValue: new Decimal(lines[0].faceValue.toString()),
        currency: lines[0].currency,
        providerRaw: result.raw as Record<string, unknown>,
      },
      t,
    );

    if (codes.length) {
      // INVARIANT 3 — consume reserved stock per product, in the same
      // transaction that writes the codes. Per-product because quantities
      // differ per line; a blanket updateMany would misattribute decrements.
      for (const item of order.items) {
        await t.product.update({
          where: { id: item.productId },
          data: {
            reservedStock: { decrement: item.quantity },
            totalStock: { decrement: item.quantity },
          },
        });
      }

      await t.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.COMPLETED,
          fulfillmentStatus: FulfillmentStatus.DELIVERED,
          // Stamped here, at issuance. `deliveryLatencyMs` is filled in once the
          // email lands — see deliverOrderEmail.
          codesIssuedAt: new Date(),
        },
      });
    }
  });

  log.info('fulfillment_done', {
    orderId,
    externalId: result.externalId,
    codes: codes.length,
    masked: codes.slice(0, 3).map((c) => maskCode(c.code)),
  });

  return {
    orderId,
    status: codes.length ? 'DELIVERED' : 'PROCESSING',
    externalId: result.externalId,
    codeCount: codes.length,
  };
}

async function upsertFulfillment(
  args: {
    orderId: string;
    provider: string;
    externalId?: string;
    status: FulfillmentStatus;
    codesCipher?: string | null;
    codeCount?: number;
    faceValue?: Decimal;
    currency?: string;
    failureReason?: string;
    providerRaw?: Record<string, unknown> | null;
  },
  t?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const db = (t ?? prisma) as typeof prisma;
  const data = {
    status: args.status,
    codesCipher: args.codesCipher ?? null,
    codeCount: args.codeCount ?? 0,
    faceValue: args.faceValue ?? null,
    currency: args.currency ?? null,
    failureReason: args.failureReason ?? null,
    providerRaw: (args.providerRaw ?? null) as any,
    deliveredAt: args.status === FulfillmentStatus.DELIVERED ? new Date() : null,
  };

  // UNIQUE(externalId) is the idempotency guard — update on repeat.
  if (args.externalId) {
    const existing = await db.fulfillment.findUnique({ where: { externalId: args.externalId } });
    if (existing) return db.fulfillment.update({ where: { id: existing.id }, data });
  }
  return db.fulfillment.create({
    data: { orderId: args.orderId, provider: args.provider, ...(args.externalId ? { externalId: args.externalId } : {}), ...data },
  });
}

/** Poll the issuer for orders that never produced codes (webhook-less path). */
export async function pollPendingFulfillments(limit = 25): Promise<number> {
  ensureProviders();
  const pending = await prisma.fulfillment.findMany({
    where: { status: { in: [FulfillmentStatus.PROCESSING, FulfillmentStatus.PENDING] }, externalId: { not: null } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: { order: { include: { items: { include: { product: true } } } } },
  });

  let processed = 0;
  for (const f of pending) {
    const providerKey = f.order.items[0]?.product.provider ?? f.provider;
    let provider;
    try {
      provider = getProvider(providerKey);
    } catch {
      continue;
    }
    try {
      const res = await provider.getOrder(f.externalId!);
      if (!res) continue;
      if (res.status === 'DELIVERED' && res.codes.length) {
        const codes: StoredCode[] = res.codes.map((c) => ({
          code: c.code,
          pin: c.pin ?? null,
          faceValue: c.faceValue ? c.faceValue.toFixed(2) : null,
          currency: c.currency ?? null,
          expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
        }));
        await prisma.$transaction(async (t) => {
          await t.fulfillment.update({
            where: { id: f.id },
            data: {
              status: FulfillmentStatus.DELIVERED,
              codesCipher: encryptCodes(codes),
              codeCount: codes.length,
              deliveredAt: new Date(),
              providerRaw: (res.raw ?? null) as any,
            },
          });
          for (const item of f.order.items) {
            await t.product.update({
              where: { id: item.productId },
              data: { reservedStock: { decrement: item.quantity }, totalStock: { decrement: item.quantity } },
            });
          }
          await t.order.update({
            where: { id: f.orderId },
            data: { status: OrderStatus.COMPLETED, fulfillmentStatus: FulfillmentStatus.DELIVERED, codesIssuedAt: new Date() },
          });
        });
        processed++;
      } else if (res.status === 'FAILED') {
        await prisma.fulfillment.update({
          where: { id: f.id },
          data: { status: FulfillmentStatus.FAILED, failureReason: res.failureReason ?? 'issuer_failed' },
        });
        await prisma.order.update({
          where: { id: f.orderId },
          data: { status: OrderStatus.FAILED, failureReason: res.failureReason ?? 'issuer_failed' },
        });
        processed++;
      }
    } catch (e) {
      log.warn('poll_fulfillment_failed', { fulfillmentId: f.id, err: (e as Error).message });
    }
  }
  return processed;
}

/** Apply an inbound issuer webhook. */
export async function applyProviderWebhook(args: {
  providerKey: string;
  externalId: string;
  status: ProviderOrderResultLike['status'];
  codes: ProviderCode[];
}): Promise<{ applied: boolean; reason?: string }> {
  const fulfillment = await prisma.fulfillment.findUnique({
    where: { externalId: args.externalId },
    include: { order: { include: { items: true } } },
  });
  if (!fulfillment) return { applied: false, reason: 'unknown_external_id' };

  // Idempotent: already delivered with the same number of codes -> no-op.
  if (fulfillment.status === FulfillmentStatus.DELIVERED && fulfillment.codeCount === args.codes.length && args.codes.length > 0) {
    return { applied: true, reason: 'already_applied' };
  }

  if (args.status === 'DELIVERED' && args.codes.length) {
    const stored: StoredCode[] = args.codes.map((c) => ({
      code: c.code,
      pin: c.pin ?? null,
      faceValue: c.faceValue ? c.faceValue.toFixed(2) : null,
      currency: c.currency ?? null,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    }));
    await prisma.$transaction(async (t) => {
      await t.fulfillment.update({
        where: { id: fulfillment.id },
        data: { status: FulfillmentStatus.DELIVERED, codesCipher: encryptCodes(stored), codeCount: stored.length, deliveredAt: new Date() },
      });
      for (const item of fulfillment.order.items) {
        await t.product.update({
          where: { id: item.productId },
          data: { reservedStock: { decrement: item.quantity }, totalStock: { decrement: item.quantity } },
        });
      }
      await t.order.update({
        where: { id: fulfillment.orderId },
        data: { status: OrderStatus.COMPLETED, fulfillmentStatus: FulfillmentStatus.DELIVERED, codesIssuedAt: new Date() },
      });
    });
    return { applied: true };
  }

  if (args.status === 'FAILED') {
    await prisma.$transaction([
      prisma.fulfillment.update({ where: { id: fulfillment.id }, data: { status: FulfillmentStatus.FAILED, failureReason: 'issuer_webhook_failed' } }),
      prisma.order.update({ where: { id: fulfillment.orderId }, data: { status: OrderStatus.FAILED, failureReason: 'issuer_webhook_failed' } }),
    ]);
    return { applied: true };
  }

  await prisma.fulfillment.update({ where: { id: fulfillment.id }, data: { status: FulfillmentStatus.PROCESSING } });
  return { applied: true, reason: 'still_processing' };
}

type ProviderOrderResultLike = { status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' };

// ---------------------------------------------------------------------------
// Reading codes back out
// ---------------------------------------------------------------------------

export interface RevealedCode {
  code: string;
  pin: string | null;
  faceValue: string | null;
  currency: string | null;
  expiresAt: string | null;
}

/** Decrypt the codes for an order. Callers must have authorised the request. */
export async function revealCodes(orderId: string): Promise<RevealedCode[]> {
  const rows = await prisma.fulfillment.findMany({
    where: { orderId, status: FulfillmentStatus.DELIVERED, codesCipher: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
  const out: RevealedCode[] = [];
  for (const r of rows) {
    if (!r.codesCipher) continue;
    for (const c of decryptCodes<StoredCode>(r.codesCipher)) {
      out.push({
        code: c.code,
        pin: c.pin ?? null,
        faceValue: c.faceValue ?? null,
        currency: c.currency ?? null,
        expiresAt: c.expiresAt ?? null,
      });
    }
  }
  return out;
}