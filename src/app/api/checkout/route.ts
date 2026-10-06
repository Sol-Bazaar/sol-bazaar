import { NextResponse } from 'next/server';
import { createOrder } from '@/lib/orders';
import { getTenant } from '@/lib/tenant';
import { Decimal } from 'decimal.js';

export async function POST(req: Request) {
  try {
    const tenant = await getTenant();
    const body = await req.json();
    const { lines, email } = body;

    if (!lines?.length) {
      return NextResponse.json({ error: 'No items in cart' }, { status: 400 });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    // Calculate totals - in production, fetch real prices from Cryptorefills
    let subtotalUsd = new Decimal(0);
    for (const line of lines) {
      const faceValue = new Decimal(line.faceValue);
      subtotalUsd = subtotalUsd.plus(faceValue.mul(line.quantity));
    }

    const platformFeeBps = 200; // 2%
    const platformFee = subtotalUsd.mul(platformFeeBps).div(10000);
    const totalUsd = subtotalUsd.plus(platformFee);

    // Create order
    const order = await createOrder({
      tenantId: tenant.id,
      email,
      lines: lines.map((l: any) => ({
        productId: l.productId,
        faceValue: l.faceValue,
        quantity: l.quantity,
        unitPriceUsd: l.faceValue,
      })),
      subtotalUsd: subtotalUsd.toFixed(2),
      platformFee: platformFee.toFixed(2),
      totalUsd: totalUsd.toFixed(2),
      token: 'USDC',
      status: 'PENDING_PAYMENT',
    });

    // Generate unique deposit address for this order
    const depositAddress = generateDepositAddress(order.id);

    return NextResponse.json({
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      depositAddress,
      amountUsd: totalUsd.toFixed(2),
      platformFee: platformFee.toFixed(2),
      subtotalUsd: subtotalUsd.toFixed(2),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  } catch (e) {
    console.error('Checkout error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function generateDepositAddress(orderId: string): string {
  // In production, derive from HD wallet using order ID as derivation index
  // For now, return a placeholder - replace with real HD derivation
  return '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'; // Example Solana address
}