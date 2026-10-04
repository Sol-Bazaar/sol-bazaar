import { NextResponse } from 'next/server';

/**
 * GET /api/order/lookup
 *
 * Redirects from the "find my order" form to the order page. Kept as a route
 * (rather than a client-side router push) so the form works with JavaScript
 * disabled, and so the order number/email pair ends up in a shareable URL.
 *
 * Deliberately performs no lookup itself — the order page re-checks the email
 * against the order and renders the lookup gate if it does not match. This
 * endpoint therefore cannot be used to enumerate valid order numbers.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderNumber = (url.searchParams.get('orderNumber') ?? '').trim();
  const email = (url.searchParams.get('email') ?? '').trim();

  if (!orderNumber || !email) {
    return NextResponse.redirect(new URL('/orders?error=missing', url.origin));
  }

  const target = new URL(`/order/${encodeURIComponent(orderNumber)}`, url.origin);
  target.searchParams.set('email', email);
  return NextResponse.redirect(target);
}