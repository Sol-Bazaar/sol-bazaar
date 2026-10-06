import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { updateOrderStatus, markOrderCompleted, getOrderByNumber } from '@/lib/orders';
import { createCryptorefillsOrder } from '@/lib/cryptorefills';
import { Decimal } from 'decimal.js';

export async function POST(req: Request) {
  try {
    const headersList = headers();
    const signature = headersList.get('x-cryptorefills-signature');
    const body = await req.text();

    // Verify webhook signature
    const webhookSecret = process.env.CRYPTOREFILLS_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      const isValid = verifyWebhookSignature(body, signature, webhookSecret);
      if (!isValid) {
        console.error('Invalid webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    const event = JSON.parse(body);
    console.log('Cryptorefills webhook:', event.type, event.order_id);

    switch (event.type) {
      case 'order.created':
        await handleOrderCreated(event);
        break;
      case 'order.paid':
        await handleOrderPaid(event);
        break;
      case 'order.completed':
        await handleOrderCompleted(event);
        break;
      case 'order.failed':
      case 'order.expired':
        await handleOrderFailed(event);
        break;
      default:
        console.log('Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function handleOrderCreated(event: any) {
  const { order_id, status } = event;
  console.log(`Order created: ${order_id} - ${status}`);
  // Order is created on Cryptorefills side, we can update our order status
}

async function handleOrderPaid(event: any) {
  const { order_id, payment } = event;
  console.log(`Order paid: ${order_id}`);

  // Find our order by external ID
  // In production, store Cryptorefills order_id in our order record
  const order = await findOrderByCryptorefillsId(order_id);
  if (order) {
    // Update our order status
    // await updateOrderStatus(order.id, 'PAID');
    console.log(`Marked order ${order.id} as PAID`);
  }
}

async function handleOrderCompleted(event: any) {
  const { order_id, delivery } = event;
  console.log(`Order completed: ${order_id}`);

  const order = await findOrderByCryptorefillsId(order_id);
  if (order && delivery?.codes) {
    // Store codes and mark completed
    // await markOrderCompleted(order.id, delivery.codes);
    console.log(`Marked order ${order.id} as COMPLETED with ${delivery.codes.length} codes`);
  }
}

async function handleOrderFailed(event: any) {
  const { order_id, error } = event;
  console.log(`Order failed: ${order_id} - ${error}`);

  const order = await findOrderByCryptorefillsId(order_id);
  if (order) {
    // await updateOrderStatus(order.id, 'FAILED');
    console.log(`Marked order ${order.id} as FAILED`);
  }
}

async function findOrderByCryptorefillsId(cryptorefillsOrderId: string): Promise<{ id: string } | null> {
  // In production, maintain a mapping table
  // For now, return null
  return null;
}

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  // Cryptorefills uses HMAC-SHA256
  const crypto = require('crypto');
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

// Function to create order on Cryptorefills after payment is confirmed
async function fulfillOrderViaCryptorefills(params: {
  orderId: string;
  productId: string;
  email: string;
  currency: 'USDC';
  network: 'solana';
}) {
  try {
    const result = await createCryptorefillsOrder({
      product_id: params.productId,
      currency: params.currency,
      network: params.network,
      delivery_email: params.email,
    });
    return result;
  } catch (e) {
    console.error('Failed to create Cryptorefills order:', e);
    throw e;
  }
}