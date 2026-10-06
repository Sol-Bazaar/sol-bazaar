import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { safeCompare } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/auth
 *
 * Checks if the current request has a valid admin session.
 * Used by the admin layout to gate access.
 */
export async function GET(req: Request) {
  const token = process.env.OPERATOR_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Admin not configured' }, { status: 501 });
  }

  const jar = await cookies();
  const sessionToken = jar.get('admin_session')?.value ?? '';

  // Also accept Bearer token for API clients
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const provided = bearer || sessionToken;

  if (!provided || !safeCompare(provided, token)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * POST /api/admin/auth
 *
 * Creates an admin session cookie after verifying the operator token.
 */
export async function POST(req: Request) {
  const token = process.env.OPERATOR_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Admin not configured' }, { status: 501 });
  }

  try {
    const { password } = await req.json();
    if (!password || !safeCompare(password, token)) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
    }

    const jar = await cookies();
    jar.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8, // 8 hours
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  }
}