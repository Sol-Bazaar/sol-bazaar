'use server';

import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createOrderSchema, clientIpFromHeaders, validationFailed, createLogger } from '@solbazaar/core';
import { getTenant, getGeo } from '@/lib/tenant';
import { createOrder, normaliseEmail } from '@/lib/orders';
import { TRACKING_COOKIE } from '@/lib/tracking';
import type { TokenSymbol } from '@solbazaar/db';

const log = createLogger({ service: 'checkout' });

export interface CheckoutState {
  ok: boolean;
  error?: string;
  orderNumber?: string;
}

export interface CheckoutInput {
  lines: { productSlug: string; denomination: string; quantity: number }[];
  email: string;
  fullName?: string;
  token: TokenSymbol;
  /** Cart fingerprint so a retry of the same submit reuses the same order. */
  cartFingerprint?: string;
  /** Connected wallet, for order history only. Never a substitute for email. */
  walletAddress?: string | null;
}

/**
 * Create the order and redirect to its payment page.
 *
 * Everything the customer sends is re-validated and re-priced server-side:
 * the browser only tells us *what* they want, never *how much it costs*.
 */
export async function submitCheckout(input: CheckoutInput): Promise<CheckoutState> {
  let tenant;
  let geo;
  try {
    [tenant, geo] = await Promise.all([getTenant(), getGeo()]);
  } catch (e) {
    log.error('tenant_resolve_failed', { err: (e as Error).message });
    return { ok: false, error: 'Store is temporarily unavailable. Please try again.' };
  }

  // Email is mandatory — the codes go there and are shown on the order page.
  const email = normaliseEmail(input.email);
  if (!email) {
    return { ok: false, error: 'Enter a valid email address so we can send your gift card codes.' };
  }

  const parsed = createOrderSchema.safeParse({
    email,
    fullName: input.fullName,
    token: input.token,
    country: geo.country,
    lines: input.lines,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please check your details and try again.',
    };
  }

  const h = await headers();
  const ip = clientIpFromHeaders(h) ?? undefined;

  // Idempotency derived from the cart + email, so a double-click or a retry
  // after a flaky network returns the same order instead of charging twice.
  const fingerprint =
    input.cartFingerprint ??
    Buffer.from(
      JSON.stringify({ lines: parsed.data.lines, email: parsed.data.email, tenant: tenant.id }),
    ).toString('base64url');

  try {
    const { order, trackingToken } = await createOrder({
      tenant,
      lines: parsed.data.lines,
      email,
      fullName: parsed.data.fullName,
      country: geo.country,
      token: parsed.data.token,
      idempotencyKey: `web:${fingerprint}`.slice(0, 180),
      ip,
      userAgent: h.get('user-agent') ?? undefined,
      walletAddress: input.walletAddress ?? null,
    });

    revalidatePath('/orders');

    /*
     * Stash the tracking token in an httpOnly cookie so the order page can build
     * the customer's bookmarkable tracking link.
     *
     * - httpOnly: script on the page cannot read it.
     * - sameSite=Lax: not sent on cross-site POSTs, so this cannot be set from an
     *   attacker page to hijack a victim's link.
     * - Secure in production, alongside HSTS.
     * - Short-lived (2h): the email lookup remains the permanent fallback.
     * - Only ONE order's token is retained, so a shared browser cannot leak the
     *   previous customer's link.
     */
    const jar = await cookies();
    jar.set(TRACKING_COOKIE, trackingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: `/order/${order.orderNumber}`,
      maxAge: 2 * 60 * 60,
    });

    redirect(`/order/${order.orderNumber}?created=1`);
  } catch (e) {
    // `redirect()` throws a control-flow error — never surface it as a failure.
    if (e && typeof e === 'object' && 'digest' in e && String((e as any).digest).startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    const message = e instanceof Error ? e.message : 'Something went wrong';
    log.warn('checkout_failed', { err: message, country: geo.country });
    return { ok: false, error: friendly(message) };
  }
}

/** Translate internal errors into something a customer can act on. */
function friendly(message: string): string {
  if (/out of stock/i.test(message)) return message;
  if (/Minimum order/i.test(message)) return message;
  if (/Maximum order/i.test(message)) return message;
  if (/not available in/i.test(message)) return message;
  if (/WALLET_SEED|CODE_ENCRYPTION_KEY|WALLET_MASTER_KEY/.test(message)) {
    return 'Payments are being configured. Please contact support.';
  }
  if (/Invalid denomination/i.test(message)) return 'One of the selected amounts is no longer available. Please pick again.';
  if (/Validation failed/i.test(message)) return 'Please check the details you entered.';
  return 'We could not start your order. Please try again in a moment.';
}

export async function lookupOrderAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const orderNumber = String(formData.get('orderNumber') ?? '').trim().toUpperCase();
  if (!email || !orderNumber) redirect('/orders?error=missing');
  redirect(`/order/${encodeURIComponent(orderNumber)}?email=${encodeURIComponent(email)}`);
}
