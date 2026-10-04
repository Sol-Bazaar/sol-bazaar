/**
 * Sign-In With Solana — message construction and strict parsing.
 *
 * ## Why sign a message at all?
 *
 * Connecting a wallet proves nothing on its own: anyone can hand the app any
 * address. What proves ownership is the user signing a challenge with the
 * private key **inside their wallet**. We verify that signature on the server
 * and only then create a session. The private key never leaves the extension,
 * and we never ask for it.
 *
 * This is the same model as "Sign in with Google", except the credential is an
 * ed25519 key pair instead of an OAuth token.
 *
 * ## Why bind the message so tightly?
 *
 * A bare "please sign this random string" challenge is vulnerable to replay and
 * to cross-origin reuse. Every field below closes a specific hole:
 *
 * | Field             | Stops |
 * |-------------------|-------|
 * | `Domain`          | A signature harvested on evil.com being replayed here |
 * | `URI`             | A signature obtained for a different origin/path |
 * | `Chain`           | A devnet signature being used against mainnet (or vice versa) |
 * | `Nonce` (single-use, expiring) | Replaying a captured valid message |
 * | `Issued At`       | Using a very old captured message |
 * | `Expiration Time` | A signature sitting in a proxy log being used days later |
 * | Human-readable body | The user can see exactly what they are approving |
 *
 * The body also states plainly that no transaction is triggered and no gas is
 * spent, because "sign in" phishing lures rely on that ambiguity.
 *
 * ## Deliberately browser-safe
 *
 * Uses only `globalThis.crypto` (present in Node 20+ and browsers) so this
 * module can be imported from both Server and Client Components.
 */

export const SIWS_VERSION = '1';
export const NONCE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const CLUSTER_LABELS: Record<string, string> = {
  'mainnet-beta': 'solana:mainnet-beta',
  devnet: 'solana:devnet',
  testnet: 'solana:testnet',
  localnet: 'solana:localnet',
};

export interface SiwsFields {
  domain: string;
  uri: string;
  address: string;
  /** Cluster label, e.g. `solana:mainnet-beta`. Binds a devnet signature so it
   *  cannot be replayed against mainnet (or the reverse). */
  chain: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  statement?: string;
}

/** Default, explicit statement. The user reads this in their wallet. */
export const DEFAULT_STATEMENT =
  'Sign in to Sol Bazaar. This request will not trigger a blockchain transaction or cost any gas.';

/**
 * Cryptographically random nonce, 32 hex characters.
 *
 * `getRandomValues` is a CSPRNG in both browsers and Node, so the same code is
 * safe on either side. Never use `Math.random()` here — a predictable nonce
 * lets an attacker pre-sign messages.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (!c?.getRandomValues) {
    throw new Error('A cryptographically secure random source is required');
  }
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildSignInMessage(f: SiwsFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    '',
    f.statement ?? DEFAULT_STATEMENT,
    '',
    `URI: ${f.uri}`,
    `Version: ${SIWS_VERSION}`,
    `Chain: ${f.chain}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt.toISOString()}`,
    `Expiration Time: ${f.expiresAt.toISOString()}`,
  ].join('\n');
}

/**
 * Parse a signed message back into fields.
 *
 * Strict by design: the exact line set must be present, and anything unexpected
 * makes this return null. A permissive parser is how message-confusion attacks
 * get in — e.g. appending a second "Nonce:" line so the verifier reads a
 * different one than the user saw.
 */
export function parseSignInMessage(message: string): Record<string, string> | null {
  if (typeof message !== 'string' || message.length > 4096) return null;
  const lines = message.split('\n');

  const header = lines[0]?.match(/^(.+) wants you to sign in with your Solana account:$/);
  if (!header) return null;

  const address = lines[1]?.trim();
  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;

  const out: Record<string, string> = { domain: header[1] };

  let i = 2;
  if (lines[i] !== '') return null; // blank line after the address
  i++;

  const statement: string[] = [];
  while (i < lines.length && !lines[i].includes(': ')) {
    statement.push(lines[i]);
    i++;
  }
  if (!statement.length || !statement.join('').trim()) return null;
  out.statement = statement.join('\n');

  // Remaining lines must be exactly the key: value set we issue.
  const allowed = new Set(['URI', 'Version', 'Chain', 'Nonce', 'Issued At', 'Expiration Time']);
  const seen = new Set<string>();
  for (; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(': ');
    if (idx < 0) return null;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 2);
    if (!allowed.has(key)) return null; // unknown field -> reject
    if (seen.has(key)) return null; // duplicate field -> reject
    if (!value) return null;
    seen.add(key);
    out[key] = value;
  }

  for (const required of allowed) {
    if (!seen.has(required)) return null;
  }
  if (out.Version !== SIWS_VERSION) return null;
  if (!/^[0-9a-f]{32}$/.test(out.Nonce)) return null;

  const issued = Date.parse(out['Issued At']);
  const expires = Date.parse(out['Expiration Time']);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return null;

  out.__issuedAtMs = String(issued);
  out.__expiresAtMs = String(expires);
  return out;
}

export interface VerifyOptions {
  /** Exact public origin, e.g. `https://gift.example.com`. */
  expectedUri: string;
  expectedDomain: string;
  expectedChain: string;
  /** Clock-skew allowance in ms (default 60s). */
  skewMs?: number;
}

/**
 * Check a parsed message against what we expected to have issued.
 *
 * Separated from signature verification so it is trivially testable, and so the
 * signature is only checked once every *cheap, high-signal* condition has passed.
 */
export function validateSignInFields(
  parsed: Record<string, string> | null,
  opts: VerifyOptions,
): { ok: true } | { ok: false; reason: string } {
  if (!parsed) return { ok: false, reason: 'malformed_message' };
  const skew = opts.skewMs ?? 60_000;
  const now = Date.now();

  if (parsed.domain !== opts.expectedDomain) return { ok: false, reason: 'domain_mismatch' };

  // Compare normalised URLs so a trailing slash or default port cannot be used
  // to smuggle a different origin past the check.
  if (normaliseUrl(parsed.URI) !== normaliseUrl(opts.expectedUri)) return { ok: false, reason: 'uri_mismatch' };
  if (parsed.Chain !== opts.expectedChain) return { ok: false, reason: 'chain_mismatch' };

  const issued = Number(parsed.__issuedAtMs);
  const expires = Number(parsed.__expiresAtMs);

  // Issued in the future beyond skew => forged or clock-skewed replay.
  if (issued > now + skew) return { ok: false, reason: 'issued_in_future' };
  // Older than an hour => treat as a stale capture.
  if (now - issued > 60 * 60 * 1000) return { ok: false, reason: 'issued_too_long_ago' };
  if (expires <= now) return { ok: false, reason: 'message_expired' };
  // Guard against an absurdly long-lived message.
  if (expires - issued > NONCE_TTL_MS + skew) return { ok: false, reason: 'expiry_window_too_long' };

  return { ok: true };
}

export function normaliseUrl(u: string): string {
  try {
    const url = new URL(u);
    const port = url.port && !['80', '443'].includes(url.port) ? `:${url.port}` : '';
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return u.trim().replace(/\/$/, '');
  }
}

/** Shorten an address for display: `7xKX…gAsU`. */
export function shortAddress(addr: string, lead = 4, tail = 4): string {
  if (!addr || addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}