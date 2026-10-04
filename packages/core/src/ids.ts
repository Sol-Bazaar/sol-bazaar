import { randomBytes, randomUUID, createHash } from 'node:crypto';

// Alphabet without look-alike characters (0/O, 1/I/l) — these end up in URLs,
// emails and printed on gift cards, so keep them unambiguous.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function secureAlnum(len: number): string {
  const out: string[] = [];
  const buf = randomBytes(len * 2);
  for (let i = 0; out.length < len; i++) {
    const b = buf[i % buf.length];
    // Reject bytes >= 250 to avoid modulo bias, then pull 5 bits per char.
    if (b >= 250) continue;
    out.push(ALPHABET[b % ALPHABET.length]);
  }
  return out.join('');
}

/** Human-friendly order reference, e.g. `FC-7KQ4M2`. */
export function orderNumber(prefix = 'FC'): string {
  return `${prefix}-${secureAlnum(6)}`;
}

/** Short opaque public id (used for share links / support chats). */
export function publicId(len = 10): string {
  return secureAlnum(len);
}

export function uuid(): string {
  return randomUUID();
}

/** URL-safe random token, used for API key secrets and webhook ids. */
export function token(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashIp(ip: string, salt: string): string {
  return sha256(`${salt}:${ip}`);
}

export function hmacHex(secret: string, body: string): string {
  return createHash('sha256').update(`${secret}.${body}`).digest('hex');
}

/** Build a CSV/Google-Sheets style slug from arbitrary brand names. */
export function slugify(input: string, maxLen = 64): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || 'item'
  );
}

/** Encode a global or tenant-scoped natural key. */
export function scopeKey(scope: string, slug: string): string {
  return `${scope}:${slug}`;
}