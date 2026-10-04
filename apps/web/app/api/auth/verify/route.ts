import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant';
import { verifySignIn, sessionCookieOptions } from '@/lib/wallet-auth';
import { MemoryRateLimiter, hashIp, createLogger, normaliseError } from '@solbazaar/core';

export const dynamic = 'force-dynamic';

const log = createLogger({ service: 'api:auth-verify' });
const limiter = new MemoryRateLimiter(20_000);

const bodySchema = z.object({
  address: z.string().trim().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana address'),
  signature: z.string().trim().min(64).max(1024).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Signature must be base58'),
  nonce: z.string().trim().length(32).regex(/^[0-9a-f]{32}$/, 'Invalid nonce'),
});

/**
 * POST /api/auth/verify
 *
 * Step 2: exchange a signed SIWS message for a session cookie.
 *
 * Security properties:
 *   - The signed message is **reconstructed server-side** from the nonce row, so
 *     a client cannot get us to verify an arbitrary string.
 *   - The nonce must match both the request body and the `fc_siw` cookie, and is
 *     single-use.
 *   - Domain, URI (normalised), cluster, issue time and expiry are all checked
 *     before the signature.
 *   - The nonce is consumed atomically before the session is created, so replay
 *     and races are both impossible.
 *   - Session token is stored only as SHA-256; the raw value lives solely in an
 *     httpOnly cookie.
 *   - Rate limited hard per IP (5/min) and per address (10/min): signature
 *     verification is the expensive part and an oracle for guessing.
 *
 * This endpoint NEVER returns a private key, never accepts one, and never asks
 * the wallet to sign a transaction.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const origin =
      req.headers.get('x-forwarded-proto') && req.headers.get('x-forwarded-host')
        ? `${req.headers.get('x-forwarded-proto')}://${req.headers.get('x-forwarded-host')}`
        : url.origin;

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anonymous';
    const ipHash = hashIp(ip, process.env.IP_HASH_SALT ?? 'fc');

    const rl = await limiter.hit(`verify:${ip}`, 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Try again in a minute.' } },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec), 'Cache-Control': 'no-store' } },
      );
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Body must be JSON' } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Invalid sign-in payload',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Defence in depth: the nonce must also be the one we handed to this browser.
    const cookieNonce = req.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('fc_siw='))
      ?.slice('fc_siw='.length);

    if (!cookieNonce || cookieNonce !== parsed.data.nonce) {
      log.warn('verify_nonce_cookie_mismatch', { hasCookie: Boolean(cookieNonce) });
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'Sign-in challenge does not match this browser. Reload and try again.' } },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Second limit, keyed by address, so a botnet cannot spread guesses widely.
    const byAddr = await limiter.hit(`verify:addr:${parsed.data.address}`, 10, 60_000);
    if (!byAddr.allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited', message: 'Too many attempts for this wallet.' } },
        { status: 429, headers: { 'Retry-After': String(byAddr.retryAfterSec), 'Cache-Control': 'no-store' } },
      );
    }

    let tenantId: string | null = null;
    try {
      tenantId = (await getTenant()).id;
    } catch {
      /* tenant is optional context for the session record */
    }

    const session = await verifySignIn({
      address: parsed.data.address,
      signature: parsed.data.signature,
      nonce: parsed.data.nonce,
      domain: url.host,
      uri: `${origin}/`,
      tenantId,
      ipHash,
      userAgent: req.headers.get('user-agent'),
    });

    const res = NextResponse.json(
      {
        data: {
          address: session.address,
          chain: session.chain,
          expiresAt: session.expiresAt.toISOString(),
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );

    const opts = sessionCookieOptions(session.expiresAt);
    res.cookies.set(opts.name, session.sessionToken, {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
      expires: opts.expires,
    });
    // Nonce cookie is spent.
    res.cookies.set('fc_siw', '', { httpOnly: true, path: '/', maxAge: 0 });

    return res;
  } catch (e) {
    const n = normaliseError(e);
    const status = n.status >= 400 && n.status < 600 ? n.status : 401;
    if (status >= 500) log.error('verify_failed', { err: n.message });
    else log.warn('verify_rejected', { code: n.code, msg: n.message });
    return NextResponse.json(
      { error: { code: n.code, message: n.message } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

