/**
 * Server-side wallet sign-in.
 *
 * Responsibilities:
 *   1. Issue single-use, short-lived nonces bound to this exact origin+cluster.
 *   2. Verify an ed25519 signature over the SIWS message.
 *   3. Mint an opaque session token, stored only as a SHA-256 hash.
 *
 * Explicit non-goals, and why:
 *   - **We never handle private keys.** Only a signature comes back from the
 *     client. There is no code path here that accepts a seed phrase or secret key,
 *     and no API exists to import one.
 *   - **We never ask the wallet to sign a transaction at login.** A login
 *     signature must be free and side-effect-free; if we ever requested
 *     `signTransaction` here, a compromised frontend could drain a user.
 *   - **The session token is never stored in plaintext**, so a database
 *     compromise does not yield usable sessions.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { prisma } from '@solbazaar/db';
import { createLogger, badRequest, unauthorized, forbidden } from '@solbazaar/core';
import {
  buildSignInMessage,
  generateNonce,
  parseSignInMessage,
  validateSignInFields,
  CLUSTER_LABELS,
  NONCE_TTL_MS,
  SESSION_TTL_MS,
} from '@solbazaar/core';

const log = createLogger({ service: 'wallet-auth' });

export const SESSION_COOKIE = 'fc_session';

function clusterLabel(): string {
  return CLUSTER_LABELS[process.env.SOLANA_CLUSTER ?? 'devnet'] ?? 'solana:devnet';
}

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Nonce
// ---------------------------------------------------------------------------

export interface IssuedNonce {
  nonce: string;
  message: string;
  domain: string;
  uri: string;
  chain: string;
  expiresAt: Date;
}

export async function issueNonce(args: {
  domain: string;
  uri: string;
  ipHash?: string | null;
}): Promise<IssuedNonce> {
  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
  const chain = clusterLabel();

  await prisma.walletNonce.create({
    data: { nonce, domain: args.domain, expiresAt, ipHash: args.ipHash ?? null },
  });

  // Opportunistic cleanup; bounded so it never becomes a long-running job.
  await prisma.walletNonce
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })
    .catch(() => undefined);

  const message = buildSignInMessage({
    domain: args.domain,
    uri: args.uri,
    address: '', // filled in by the client once the wallet is connected
    chain,
    nonce,
    issuedAt,
    expiresAt,
  });

  return { nonce, message, domain: args.domain, uri: args.uri, chain, expiresAt };
}

/**
 * Rebuild the message with the connected address filled in.
 *
 * The client sends us the address it wants to authenticate as, and we rebuild
 * the exact message here from server-held state. That way the string we verify is
 * always one *we* constructed — we never verify an arbitrary blob the browser
 * happened to send, which is the classic message-confusion bug.
 */
export async function buildMessageForAddress(args: {
  nonce: string;
  address: string;
  domain: string;
  uri: string;
}): Promise<string | null> {
  const record = await prisma.walletNonce.findUnique({ where: { nonce: args.nonce } });
  if (!record) return null;
  if (record.consumedAt) return null;
  if (record.expiresAt.getTime() < Date.now()) return null;
  if (record.domain !== args.domain) return null;

  // The nonce row does not store Issued At, so derive a consistent window:
  // issued "now" minus nothing, expiring at the recorded deadline. We store the
  // original issuedAt in the message we hand out; here we recompute from the
  // expiry to keep both sides identical.
  const issuedAt = new Date(record.expiresAt.getTime() - NONCE_TTL_MS);
  return buildSignInMessage({
    domain: args.domain,
    uri: args.uri,
    address: args.address,
    chain: clusterLabel(),
    nonce: record.nonce,
    issuedAt,
    expiresAt: record.expiresAt,
  });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifiedWallet {
  address: string;
  chain: string;
  sessionToken: string;
  expiresAt: Date;
}

export async function verifySignIn(args: {
  address: string;
  signature: string; // base58
  nonce: string;
  domain: string;
  uri: string;
  tenantId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
}): Promise<VerifiedWallet> {
  const address = args.address?.trim();
  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw badRequest('Invalid wallet address');
  }
  if (!args.signature || args.signature.length > 1024) {
    throw badRequest('Invalid signature');
  }

  // Reconstruct the message server-side (see note on buildMessageForAddress).
  const message = await buildMessageForAddress({
    nonce: args.nonce,
    address,
    domain: args.domain,
    uri: args.uri,
  });
  if (!message) throw unauthorized('Sign-in challenge is unknown, already used, or expired');

  // Cheap structural + context checks before touching crypto.
  const parsed = parseSignInMessage(message);
  const verdict = validateSignInFields(parsed, {
    expectedUri: args.uri,
    expectedDomain: args.domain,
    expectedChain: clusterLabel(),
  });
  if (!verdict.ok) {
    log.warn('signin_field_rejected', { reason: verdict.reason, domain: args.domain });
    throw unauthorized('Sign-in challenge is not valid for this site');
  }
  if (!parsed || parsed.Nonce !== args.nonce) throw unauthorized('Nonce mismatch');
  if (!parsed.URI || parsed.URI !== args.uri) throw unauthorized('URI mismatch');

  // ed25519 signature check against the public key = the address itself.
  let sigBytes: Uint8Array;
  let pubBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(args.signature);
    pubBytes = bs58.decode(address);
  } catch {
    throw unauthorized('Signature is not valid base58');
  }
  if (sigBytes.length !== 64 || pubBytes.length !== 32) {
    throw unauthorized('Signature has the wrong length');
  }

  const ok = nacl.sign.detached.verify(new TextEncoder().encode(message), sigBytes, pubBytes);
  if (!ok) {
    log.warn('signin_bad_signature', { domain: args.domain, chain: clusterLabel() });
    throw unauthorized('Signature does not match this wallet');
  }

  // Consume the nonce atomically BEFORE creating the session, so two concurrent
  // verifications of the same signature cannot both produce a session.
  const consumed = await prisma.walletNonce.updateMany({
    where: { nonce: args.nonce, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date(), walletAddress: address },
  });
  if (consumed.count !== 1) {
    log.warn('signin_nonce_replay', { domain: args.domain });
    throw unauthorized('Sign-in challenge was already used');
  }

  // Mint an opaque token. 32 bytes of CSPRNG entropy; only the hash is stored.
  const sessionToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.walletSession.create({
    data: {
      walletAddress: address,
      tokenHash: hashToken(sessionToken),
      tenantId: args.tenantId ?? null,
      chain: clusterLabel(),
      domain: args.domain,
      userAgent: args.userAgent?.slice(0, 300) ?? null,
      ipHash: args.ipHash ?? null,
      expiresAt,
    },
  });

  // One active session per address per site keeps the table from growing and
  // makes "log out everywhere" trivial later.
  await prisma.walletSession
    .updateMany({
      where: { walletAddress: address, domain: args.domain, revokedAt: null, id: { not: (await latestSessionId(address, args.domain)) ?? '' } },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);

  log.info('wallet_signed_in', { domain: args.domain, chain: clusterLabel() });

  return { address, chain: clusterLabel(), sessionToken, expiresAt };
}

async function latestSessionId(address: string, domain: string): Promise<string | null> {
  const row = await prisma.walletSession.findFirst({
    where: { walletAddress: address, domain, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function resolveSession(token: string | undefined): Promise<{
  address: string;
  chain: string;
  expiresAt: Date;
} | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const session = await prisma.walletSession.findUnique({
    where: { tokenHash },
    select: { id: true, walletAddress: true, chain: true, expiresAt: true, revokedAt: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  return { address: session.walletAddress, chain: session.chain, expiresAt: session.expiresAt };
}

/** Revoke a session. Safe to call with an unknown token. */
export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.walletSession
    .updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

/** Extend a live session (sliding window) without changing the token. */
export async function touchSession(token: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.walletSession
    .updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { lastSeenAt: new Date(), expiresAt },
    })
    .catch(() => undefined);
}

/** Cookie attributes. `__Host-` prefix is a browser-enforced guarantee. */
export function sessionCookieOptions(expiresAt: Date) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
    // `__Host-` requires Secure + Path=/ + no Domain, which rules out subdomain
    // cookie-injection attacks from a sibling tenant.
    ...(isProd ? { name: '__Host-fc_session' } : { name: SESSION_COOKIE }),
  };
}

export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-fc_session' : SESSION_COOKIE;
}

export function assertClusterMatch(requested: string): void {
  if (requested && requested !== clusterLabel()) {
    throw forbidden(`Wallet is on ${requested}, but this store settles on ${clusterLabel()}`);
  }
}