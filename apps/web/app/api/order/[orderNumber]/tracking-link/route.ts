import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@solbazaar/db';
import { verifyTrackingToken, buildTrackingUrl, unauthorized, notFound } from '@solbazaar/core';
import { jsonError } from '@/lib/api';
import { TRACKING_COOKIE } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

export interface RouteContext {
  params: Promise<{ orderNumber: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { orderNumber } = await ctx.params;
    const jar = await cookies();
    const token = jar.get(TRACKING_COOKIE)?.value;

    if (!token) {
      throw unauthorized(
        'This browser is not the one that placed the order. Open the tracking link from your confirmation email, or look the order up with your email address.',
      );
    }

    const order = await prisma.order.findFirst({
      where: { orderNumber: orderNumber.toUpperCase() },
      select: { orderNumber: true, trackingTokenHash: true, tenantId: true },
    });
    if (!order) throw notFound(`Order ${orderNumber} not found`);

    // Constant-time comparison against the stored hash.
    if (!verifyTrackingToken(token, order.trackingTokenHash)) {
      throw unauthorized('That tracking link does not belong to this order.');
    }

    const base = process.env.APP_URL?.trim() || new URL(req.url).origin;
    return NextResponse.json(
      { data: { url: buildTrackingUrl(base, order.orderNumber, token) } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return jsonError(e, req);
  }
}