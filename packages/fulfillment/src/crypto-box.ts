/**
 * AES-256-GCM envelope for redeemable codes at rest.
 *
 * Gift-card codes are bearer instruments: anyone holding the code can redeem
 * the balance. Storing them in plaintext Postgres means a single leaked
 * `SELECT` (a backup dump, a read-replica credential, a SQL injection, a
 * misconfigured admin tool) hands over real value. So codes are encrypted with
 * a key that lives *outside* the database.
 *
 * Design notes:
 *  - The ciphertext blob carries its own random IV and auth tag, so there is no
 *    shared state to manage across rows.
 *  - `Fulfillment.externalId` is UNIQUE, which is the real idempotency guard: a
 *    retried provider call updates the existing row instead of creating a
 *    second set of codes.
 *  - `CODE_ENCRYPTION_KEY` must be kept separately from `WALLET_MASTER_KEY`.
 *    Losing the wallet key means losing unreconciled deposits; leaking it means
 *    total loss. Splitting them limits the blast radius of either incident.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createLogger } from '@solbazaar/core';

const log = createLogger({ service: 'codes' });

export interface StoredCode {
  code: string;
  pin?: string | null;
  faceValue?: string | null;
  currency?: string | null;
  expiresAt?: string | null;
}

let cachedKey: { material: string; key: Buffer } | null = null;

/**
 * N=2^15 with r=8 needs ~32 MB, which is exactly Node's default `maxmem`.
 * Without raising it, `scryptSync` throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`
 * and every code write fails.
 */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function keyFor(material: string): Buffer {
  if (cachedKey?.material === material) return cachedKey.key;
  // Fixed salt: the key material is already high-entropy (32 random bytes),
  // so a per-deployment random salt is not required for security here.
  const key = scryptSync(material.normalize('NFKD'), 'solbazaar:codes:v1', 32, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: SCRYPT_MAXMEM,
  });
  cachedKey = { material, key };
  return key;
}

export function encryptCodes(codes: StoredCode[], keyMaterial?: string): string {
  const material = keyMaterial ?? process.env.CODE_ENCRYPTION_KEY;
  if (!material) throw new Error('CODE_ENCRYPTION_KEY is not set');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(material), iv);
  const plain = Buffer.from(JSON.stringify(codes), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ['c1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptCodes<T = StoredCode>(blob: string, keyMaterial?: string): T[] {
  const material = keyMaterial ?? process.env.CODE_ENCRYPTION_KEY;
  if (!material) throw new Error('CODE_ENCRYPTION_KEY is not set');
  const [v, ivB64, tagB64, dataB64] = blob.split('.');
  if (v !== 'c1') throw new Error(`Unknown code envelope version: ${v}`);
  const decipher = createDecipheriv('aes-256-gcm', keyFor(material), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as T[];
}

/** Mask a code for logs / support views: `XXXX-XXXX-ABCD-****` */
export function maskCode(code: string): string {
  const parts = code.split('-');
  if (parts.length < 2) return `${code.slice(0, 3)}${'*'.repeat(Math.max(0, code.length - 3))}`;
  const head = parts.slice(0, Math.ceil(parts.length / 2) - 1).join('-');
  const tail = parts[parts.length - 1];
  return `${head}-****-${tail.slice(-4)}`;
}

export function assertCodesKeyPresent(): void {
  if (!process.env.CODE_ENCRYPTION_KEY) {
    log.error('code_key_missing', { hint: 'Set CODE_ENCRYPTION_KEY (openssl rand -hex 32)' });
  }
}