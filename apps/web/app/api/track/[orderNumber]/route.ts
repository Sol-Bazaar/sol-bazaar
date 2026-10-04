import { NextResponse } from 'next/server';
import { prisma, OrderStatus } from '@solbazaar/db';
import { verifyTrackingToken, readTrackingToken, forbidden, notFound } from '@solbazaar/core';
import { jsonError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export interface RouteContext {
  params: Promise<{ orderNumber: string }>;
}

/**
 * GET /api/track/:orderNumber?t=<token>
 *
 * Polling endpoint behind the public tracking link.
 *
 * Returns the payment timeline and, once settled, the redeemable codes — so the
 * link works as a genuine replacement for the email, not just a status page.
 *
 * Authorisation is the opaque tracking token (SHA-256 compared in constant
 * time). Nothing personal is returned: no email, no IP hash, no user agent. A
 * wrong token returns 403 without revealing whether the order exists, so the
 * endpoint cannot be used to enumerate order numbers.
 *
 * Codes are only ever included once `status === COMPLETED`, i.e. after the
 * payment is confirmed on-chain.
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { orderNumber } = await ctx.params;
    const url = new URL(req.url);
    const token = readTrackingToken(req, url);
    if (!token) throw forbidden('This tracking link is missing its token. Use the link from your order page or confirmation email.');

    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: orderNumber.toUpperCase() }, { id: orderNumber }] },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        fulfillmentStatus: true,
        trackingTokenHash: true,
        token: true,
        tokenDecimals: true,
        mintAddress: true,
        expectedAtomic: true,
        receivedAtomic: true,
        toleranceBps: true,
        depositAddress: true,
        depositAta: true,
        expiresAt: true,
        paidAt: true,
        codesIssuedAt: true,
        emailSentAt: true,
        deliveryLatencyMs: true,
        failureReason: true,
        createdAt: true,
        totalUsd: true,
        platformFeeUsd: true,
        items: { select: { productName: true, productSlug: true, faceValue: true, currency: true, quantity: true } },
        txs: { orderBy: { seenAt: 'desc' }, take: 5, select: { signature: true, atomicAmount: true, confirmations: true, slot: true, finalized: true } },
      },
    });

    // Same response whether the order is missing or the token is wrong.
    if (!order || !verifyTrackingToken(token, order.trackingTokenHash)) {
      throw forbidden('This tracking link is not valid for that order.');
    }

    const expected = BigInt(order.expectedAtomic);
    const required = expected - (expected * BigInt(order.toleranceBps)) / 10_000n;
    const received = BigInt(order.receivedAtomic);

    const settled = order.status === OrderStatus.COMPLETED;

    // Decrypt codes only for a settled order. Server-side only.
    const codes = settled ? await revealCodesSafely(order.id) : [];

    return NextResponse.json(
      {
        data: {
          orderNumber: order.orderNumber,
          status: order.status,
          fulfillmentStatus: order.fulfillmentStatus,
          failureReason: order.failureReason,
          totals: { totalUsd: String(order.totalUsd), platformFeeUsd: String(order.platformFeeUsd) },
          items: order.items.map((i) => ({
            productName: i.productName,
            productSlug: i.productSlug,
            faceValue: String(i.faceValue),
            currency: i.currency,
            quantity: i.quantity,
          })),
          payment: {
            token: order.token,
            decimals: order.tokenDecimals,
            mint: order.mintAddress,
            depositAddress: order.depositAddress,
            associatedTokenAddress: order.depositAta,
            requiredAtomic: required.toString(),
            receivedAtomic: order.receivedAtomic,
            remainingAtomic: received < required ? (required - received).toString() : '0',
            paid: received > 0n,
            expired: order.expiresAt < new Date() && order.status === OrderStatus.PENDING_PAYMENT,
            expiresAt: order.expiresAt.toISOString(),
          },
          timeline: {
            createdAt: order.createdAt.toISOString(),
            paidAt: order.paidAt?.toISOString() ?? null,
            codesIssuedAt: order.codesIssuedAt?.toISOString() ?? null,
            emailSentAt: order.emailSentAt?.toISOString() ?? null,
            deliveryLatencyMs: order.deliveryLatencyMs,
            /** True when we are inside our own under-4-minute promise. */
            withinSla:
              order.deliveryLatencyMs == null ? null : order.deliveryLatencyMs <= 4 * 60 * 1000,
          },
          transactions: order.txs.map((t) => ({
            signature: t.signature,
            amountAtomic: t.atomicAmount,
            confirmations: t.confirmations,
            slot: t.slot,
            finalized: t.finalized,
          })),
          codes: codes.map((c) => ({
            code: c.code,
            pin: c.pin,
            faceValue: c.faceValue,
            currency: c.currency,
            expiresAt: c.expiresAt,
          })),
        },
        meta: { polledAt: new Date().toISOString() },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return jsonError(e, req);
  }
}

/**
 * Codes are decrypted here rather than in the route so a decryption failure
 * (missing CODE_ENCRYPTION_KEY) degrades to "no codes" instead of a 500 — the
 * customer still sees the order is paid and can contact support.
 */
async function revealCodesSafely(orderId: string) {
  const { revealCodes } = await import('@solbazaar/fulfillment');
  try {
    return await revealCodes(orderId);
  } catch {
    return [];
  }
}