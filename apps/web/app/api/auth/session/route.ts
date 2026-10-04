import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveSession, touchSession, sessionCookieName } from '@/lib/wallet-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/session
 *
 * Reports the currently signed-in wallet, if any.
 *
 * The client calls this on mount so a reload keeps the connection. It performs
 * no writes except a sliding refresh of the session expiry, which is why it is
 * not a static route.
 */
export async function GET() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;

  const session = await resolveSession(token);
  if (!session) {
    return NextResponse.json(
      { data: { connected: false } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  await touchSession(token!);

  return NextResponse.json(
    {
      data: {
        connected: true,
        address: session.address,
        chain: session.chain,
        expiresAt: session.expiresAt.toISOString(),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}