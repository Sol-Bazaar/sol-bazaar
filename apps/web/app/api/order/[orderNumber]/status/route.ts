import { NextResponse } from 'next/server';
import { prisma } from '@solbazaar/db';
import { forbidden, notFound, createLogger } from '@solbazaar/core';
import { jsonError } from '@/lib/api';

export const dynamic = 'force-dynamic';

const log = createLogger({ service: 'api:order-status' });

export interface RouteContext {
  params: Promise<{ orderNumber: string }>;
}

/**
 * GET /api/order/:orderNumber/status
 *
 * Narrow polling endpoint used by the payment page. Deliberately returns only
 * payment-progress fields — never codes — so it is safe to poll every few
 * seconds.
 *
 * Access control: the requester must supply the `email` the order was placed
 * with (verified by exact match). Order numbers are short and enumerable, so
 * this check is what stops anyone from walking the sequence and watching
 * arbitrary deposit addresses.
 *
 * Rate limiting is deliberately looser here than on the partner API because the
 * page legitimately polls; it is still bounded to stop enumeration at scale.
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    return await handle(req, ctx);
  } catch (e) {
    return jsonError(e, req);
  }
}

async function handle(req: Request, ctx: RouteContext) {
  const { orderNumber } = await ctx.params;
  const url = new URL(req.url);
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();

  if (!email) throw forbidden('Missing email proof');

  const order = await prisma.order.findFirst({
    where: {
      OR: [{ orderNumber: orderNumber.toUpperCase() }, { id: orderNumber }],
      email,
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      fulfillmentStatus: true,
      token: true,
      tokenDecimals: true,
      amountAtomic: true,
      expectedAtomic: true,
      receivedAtomic: true,
      toleranceBps: true,
      paymentTxCount: true,
      confirmations: true,
      expiresAt: true,
      paidAt: true,
      failureReason: true,
      txs: { orderBy: { seenAt: 'desc' }, take: 5, select: { signature: true, atomicAmount: true, confirmations: true, slot: true } },
    },
  });

  if (!order) {
    log.warn('order_status_denied', { orderNumber });
    throw notFound('Order not found for that email');
  }

  const required = BigInt(order.expectedAtomic) - (BigInt(order.expectedAtomic) * BigInt(order.toleranceBps)) / 10_000n;
  const remaining = BigInt(order.receivedAtomic) < required ? required - BigInt(order.receivedAtomic) : 0n;

  return NextResponse.json(
    {
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        failureReason: order.failureReason,
        paidAt: order.paidAt?.toISOString() ?? null,
        expiresAt: order.expiresAt.toISOString(),
        payment: {
          token: order.token,
          decimals: order.tokenDecimals,
          requiredAtomic: required.toString(),
          receivedAtomic: order.receivedAtomic,
          remainingAtomic: remaining.toString(),
          transactionCount: order.paymentTxCount,
          confirmations: order.confirmations,
        },
        transactions: order.txs,
      },
      meta: { polledAt: new Date().toISOString() },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}