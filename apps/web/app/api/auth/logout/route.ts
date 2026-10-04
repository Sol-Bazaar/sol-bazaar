import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeSession, sessionCookieName, SESSION_COOKIE } from '@/lib/wallet-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout
 *
 * Revokes the session server-side. Deleting the cookie alone would leave the
 * token valid until it expired, so the row is marked revoked — that is what
 * makes "log out" meaningful if the cookie was copied.
 */
export async function POST() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;

  await revokeSession(token);

  const res = NextResponse.json({ data: { ok: true } }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(sessionCookieName(), '', { httpOnly: true, path: '/', maxAge: 0 });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  res.cookies.set('fc_siw', '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}