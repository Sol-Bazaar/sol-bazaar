import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const NONCE_EXPIRY = 15 * 60 * 1000; // 15 minutes

// In production, use Redis or database
const nonces = new Map<string, { nonce: string; expires: number }>();

export async function GET() {
  // Generate a new nonce for SIWS
  const nonce = generateNonce();
  const expires = Date.now() + NONCE_EXPIRY;
  
  nonces.set(nonce, { nonce, expires });
  
  // Clean old nonces
  for (const [key, value] of nonces.entries()) {
    if (value.expires < Date.now()) nonces.delete(key);
  }

  return NextResponse.json({ 
    nonce,
    message: `Sign in to GiftCard Store\n\nNonce: ${nonce}\nIssued at: ${new Date().toISOString()}`,
  });
}

export async function POST(req: Request) {
  try {
    const { address, signature, nonce } = await req.json();

    if (!address || !signature || !nonce) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate nonce
    const stored = nonces.get(nonce);
    if (!stored || stored.expires < Date.now()) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 401 });
    }
    nonces.delete(nonce);

    // Verify signature
    const message = `Sign in to GiftCard Store\n\nNonce: ${nonce}\nIssued at: ${new Date().toISOString()}`;
    const messageBytes = new TextEncoder().encode(message);
    
    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(address);
    } catch {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    const signatureBytes = bs58.decode(signature);
    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Create session
    const sessionToken = generateSessionToken();
    const expiresAt = Date.now() + SESSION_DURATION;

    // Store session (in production, use Redis/database)
    // sessions.set(sessionToken, { address, expiresAt });

    // Set httpOnly cookie
    const cookieStore = cookies();
    cookieStore.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DURATION / 1000,
      path: '/',
    });

    return NextResponse.json({ 
      success: true, 
      address,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (e) {
    console.error('Auth verification error:', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  // Logout
  const cookieStore = cookies();
  cookieStore.delete('session');
  return NextResponse.json({ success: true });
}

function generateNonce(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}