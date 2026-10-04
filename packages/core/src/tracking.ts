/**
 * Order tracking tokens.
 *
 * The customer-facing tracking link needs to work after they close the tab, and
 * ideally from another device. Re-typing an email every time is a bad
 * experience, but putting the email in the URL is worse: it lands in browser
 * history, proxy logs and `Referer` headers on every outbound link.
 *
 * So instead: each order gets an opaque 256-bit token. `/track/FC-XXXXXX?t=…`
 * proves ownership of the order without revealing anything personal. Only the
 * SHA-256 hash is persisted, so a database dump yields no usable tracking links.
 *
 * The token is a *bearer* credential: whoever holds it can see the order status
 * and, once paid, the codes. That is the same trust level as the email link, and
 * it is why the token can be rotated (`rotateTrackingToken`) if a customer
 * believes a link leaked.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

/** URL-safe, unambiguous token. */
export function generateTrackingToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Last 6 chars for UI display only. */
export function trackingTokenHint(token: string): string {
  return token.slice(-6);
}

/** Constant-time compare of a presented token against a stored hash. */
export function verifyTrackingToken(token: string, storedHash: string | null | undefined): boolean {
  if (!token || !storedHash) return false;
  const a = Buffer.from(hashTrackingToken(token), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Build the tracking URL for an order.
 * `base` must be the canonical public origin, never a request Host header.
 */
export function buildTrackingUrl(base: string, orderNumber: string, token: string): string {
  const url = new URL(`/track/${encodeURIComponent(orderNumber)}`, base.replace(/\/$/, ''));
  url.searchParams.set('t', token);
  return url.toString();
}

/** Accept a token from the query string or the `Authorization: Bearer` header. */
export function readTrackingToken(req: Request, url: URL): string | null {
  const fromQuery = url.searchParams.get('t');
  if (fromQuery && /^[A-Za-z0-9_-]{40,60}$/.test(fromQuery)) return fromQuery;

  const auth = req.headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    const v = m?.[1]?.trim();
    if (v && /^[A-Za-z0-9_-]{40,60}$/.test(v)) return v;
  }
  return null;
}