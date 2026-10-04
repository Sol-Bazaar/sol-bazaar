import { NextResponse } from 'next/server';
import { prisma } from '@solbazaar/db';
import { issueNonce, sessionCookieOptions } from '@/lib/wallet-auth';
import { MemoryRateLimiter, hashIp, createLogger, unauthorized, rateLimited } from '@solbazaar/core';

export const dynamic = 'force-dynamic';

const log = createLogger({ service: 'api:auth-nonce' });
const limiter = new MemoryRateLimiter(20_000);

/**
 * GET /api/auth/nonce
 *
 * Step 1 of Sign-In With Solana: hand the client a single-use, 15-minute nonce.
 *
 * The message is returned with a placeholder address; the client rebuilds it
 * with its own address and we reconstruct it again server-side at verification
 * time from this nonce row. Nothing the client sends is trusted as text.
 *
 * Rate limited per IP: issuing nonces is unauthenticated, and without a cap it
 * is free database growth.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Bind to the origin the browser actually used, but take the host from the
    // forwarded headers the platform sets. Never trust a Host header supplied in
    // the query string.
    const origin =
      req.headers.get('x-forwarded-proto') && req.headers.get('x-forwarded-host')
        ? `${req.headers.get('x-forwarded-proto')}://${req.headers.get('x-forwarded-host')}`
        : url.origin;

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anonymous';
    const rl = await limiter.hit(`nonce:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      throw rateLimited('Too many sign-in attempts', rl.retryAfterSec);
    }

    const issued = await issueNonce({
      domain: url.host,
      uri: `${origin}/`,
      ipHash: hashIp(ip, process.env.IP_HASH_SALT ?? 'fc'),
    });

    log.debug('nonce_issued', { domain: issued.domain });

    const res = NextResponse.json(
      {
        data: {
          nonce: issued.nonce,
          message: issued.message,
          domain: issued.domain,
          uri: issued.uri,
          chain: issued.chain,
          expiresAt: issued.expiresAt.toISOString(),
        },
      },
      { headers: { 'Cache-Control': 'no-store', 'X-RateLimit-Remaining': String(rl.remaining) } },
    );

    // Bind the nonce to this browser too: a stolen nonce alone is useless
    // without the same client presenting it (defence in depth against a
    // cross-site request that can read neither cookie nor response).
    res.cookies.set('fc_siw', issued.nonce, {
      ...sessionCookieOptions(new Date(issued.expiresAt.getTime())),
      httpOnly: true,
    });

    return res;
  } catch (e) {
    if (e instanceof Error && 'code' in e) {
      const status = (e as { status?: number }).status ?? 401;
      if (status >= 500) log.error('nonce_failed', { err: (e as Error).message });
      return NextResponse.json(
        { error: { code: (e as { code: string }).code, message: (e as Error).message } },
        { status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw unauthorized('Could not start sign-in');
  }
}

/** Housekeeping: drop expired nonces. */
export async function DELETE() {
  const res = await prisma.walletNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return NextResponse.json({ data: { deleted: res.count } }, { headers: { 'Cache-Control': 'no-store' } });
}