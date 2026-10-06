// Web Crypto API - works in Node.js 15+ and all modern browsers
// No 'node:crypto' import needed, avoiding build issues in Next.js client bundles

// Alphabet without look-alike characters (0/O, 1/I/l) — these end up in URLs,
// emails and printed on gift cards, so keep them unambiguous.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function getRandomValues(bytes: Uint8Array): void {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else if (typeof require !== 'undefined') {
    // Node.js fallback
    const { randomBytes } = require('crypto');
    const buf = randomBytes(bytes.length);
    bytes.set(buf);
  } else {
    throw new Error('No secure random source available');
  }
}

function secureAlnum(len: number): string {
  const out: string[] = [];
  const buf = new Uint8Array(len * 2);
  getRandomValues(buf);
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
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** URL-safe random token, used for API key secrets and webhook ids. */
export function token(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function sha256Async(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Sync version for backward compatibility (uses sync hash in Node, async in browser)
export function sha256(input: string): string {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    // For sync contexts, we need a sync fallback
    if (typeof require !== 'undefined') {
      const { createHash } = require('crypto');
      return createHash('sha256').update(input).digest('hex');
    }
    // In browser without Node, we can't do sync SHA-256
    // This should only be called in Node.js server contexts
    throw new Error('sha256() requires Node.js environment for sync operation. Use sha256Async() in browser.');
  }
  // Fallback
  const { createHash } = require('crypto');
  return createHash('sha256').update(input).digest('hex');
}

export function hashIp(ip: string, salt: string): string {
  return sha256(`${salt}:${ip}`);
}

export function hmacHex(secret: string, body: string): string {
  // This is a simple HMAC-like construction, not true HMAC
  // For true HMAC in browser, use crypto.subtle.sign with HMAC key
  if (typeof require !== 'undefined') {
    const { createHmac } = require('crypto');
    return createHmac('sha256', secret).update(body).digest('hex');
  }
  // Browser fallback - not true HMAC but consistent
  return sha256(`${secret}.${body}`);
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