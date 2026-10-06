import { NextResponse } from 'next/server';
import { getOrder, updateOrderStatus, markOrderPaid } from '@/lib/orders';
import { verifyPayment, getDepositPublicKey } from '@/lib/wallet';
import { Decimal } from 'decimal.js';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { orderId, txSignature } = body;

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID required' }, { status: 400 });
    }

    const order = await getOrder(orderId);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.status !== 'PENDING_PAYMENT') {
      return NextResponse.json({ 
        status: order.status,
        message: `Order is already ${order.status.toLowerCase()}` 
      });
    }

    // Check if order has expired
    if (new Date() > order.expiresAt) {
      await updateOrderStatus(order.id, 'EXPIRED');
      return NextResponse.json({ 
        status: 'EXPIRED',
        message: 'Order has expired' 
      });
    }

    // If txSignature provided, verify on-chain
    if (txSignature) {
      const depositAddress = order.depositAddress;
      if (!depositAddress) {
        return NextResponse.json({ error: 'No deposit address found' }, { status: 400 });
      }

      const expectedAmount = new Decimal(order.totalUsd).mul(1_000_000).toFixed(0); // USDC has 6 decimals
      
      const verification = await verifyPayment({
        expectedAddress: order.depositAddress!,
        expectedAmount: expectedAmount,
        token: 'USDC',
        since: order.createdAt,
      });

      if (verification.found) {
        // Payment found - mark as paid
        await markOrderPaid(order.id, txSignature || verification.txSignature || '');
        
        // Trigger fulfillment via Cryptorefills
        // This would be async in production
        console.log(`Payment verified for order ${order.id}, tx: ${txSignature}`);
        
        return NextResponse.json({
          status: 'PAID',
          message: 'Payment confirmed',
          txSignature: verification.txSignature,
        });
      }
    }

    // If no txSignature or not found yet, return current status
    return NextResponse.json({
      status: 'PENDING_PAYMENT',
      message: 'Waiting for payment',
      depositAddress: order.depositAddress,
      amount: order.totalUsd,
      expiresAt: order.expiresAt.toISOString(),
    });
  } catch (e) {
    console.error('Payment verification error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderNumber = searchParams.get('orderNumber');
    const email = searchParams.get('email');

    if (!orderNumber) {
      return NextResponse.json({ error: 'Order number required' }, { status: 400 });
    }

    // In production, fetch by orderNumber and verify email
    // For now, return mock data
    return NextResponse.json({
      orderNumber,
      status: 'PENDING_PAYMENT',
      depositAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      amount: '25.00',
      token: 'USDC',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  } catch (e) {
    console.error('Order lookup error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}