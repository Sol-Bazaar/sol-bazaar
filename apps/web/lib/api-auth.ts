/**
 * Partner API authentication (the white-label REST surface).
 *
 * Key format: `fc_live_<prefix>_<secret>` — the prefix is indexed in Postgres for
 * a fast lookup, the secret is only ever stored as a scrypt hash. A leaked
 * database therefore cannot be replayed against the API.
 *
 * Keys are sent as `Authorization: Bearer <key>`.
 */
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { prisma, type ApiKey, type Tenant } from '@solbazaar/db';
import { unauthorized, forbidden, notFound, createLogger } from '@solbazaar/core';
import { resolveTenant } from '@solbazaar/tenant';

const log = createLogger({ service: 'api-auth' });

export const SCOPES = [
  'catalog:read',
  'orders:read',
  'orders:write',
  'fulfillment:read',
  'webhooks:write',
] as const;
export type Scope = (typeof SCOPES)[number];

export interface AuthContext {
  tenant: Tenant;
  apiKey?: ApiKey;
  /** True when the request was authorised by host only (public catalog). */
  public: boolean;
  scopes: Set<Scope>;
}

/** Derive the public prefix + secret halves from a full API key. */
export function parseApiKey(raw: string): { prefix: string; secret: string } | null {
  const m = /^fc_(live|test)_([a-z0-9]{6,24})_([A-Za-z0-9_-]{16,128})$/.exec(raw.trim());
  if (!m) return null;
  return { prefix: `fc_${m[1]}_${m[2]}`, secret: m[3] };
}

function hashSecret(prefix: string, secret: string): string {
  return scryptSync(`${prefix}:${secret}`, 'solbazaar:apikeys:v1', 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('base64');
}

export function generateApiKey(envLabel: 'live' | 'test' = 'live'): { key: string; prefix: string; secretHash: string } {
  const prefix = `fc_${envLabel}_${randomBytes(4).toString('hex')}`;
  const secret = randomBytes(32).toString('base64url');
  return { key: `${prefix}_${secret}`, prefix, secretHash: hashSecret(prefix, secret) };
}

export function verifySecret(secret: string, storedHash: string, prefix: string): boolean {
  const a = Buffer.from(hashSecret(prefix, secret));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/**
 * Resolve the tenant from the Host header. Required even for unauthenticated
 * catalog reads — a partner must never see another merchant's prices.
 */
export async function tenantFromRequest(req: Request): Promise<Tenant> {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const ctx = await resolveTenant({
    host,
    tenantSlug: req.headers.get('x-tenant-slug'),
    cookieSlug: parseCookie(req.headers.get('cookie'))['fc_tenant'] ?? null,
    baseDomain: process.env.BASE_DOMAIN ?? 'localhost:3000',
  });
  const tenant = await prisma.tenant.findUnique({ where: { id: ctx.id } });
  if (!tenant) throw notFound('Tenant not found');
  if (tenant.status !== 'ACTIVE') throw forbidden(`Tenant is ${tenant.status}`);
  return tenant;
}

/** Full authentication: tenant + optional API key. Public scope when no key. */
export async function authenticate(req: Request, opts: { required?: boolean } = {}): Promise<AuthContext> {
  const tenant = await tenantFromRequest(req);
  const raw = bearer(req);

  if (!raw) {
    if (opts.required) throw unauthorized('Provide `Authorization: Bearer <api-key>`');
    return { tenant, public: true, scopes: new Set(['catalog:read'] as Scope[]) };
  }

  const parsed = parseApiKey(raw);
  if (!parsed) throw unauthorized('Malformed API key (expected fc_live_<prefix>_<secret>)');

  const apiKey = await prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
  if (!apiKey) throw unauthorized('Unknown API key');
  if (apiKey.disabledAt) throw forbidden('API key disabled');
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) throw forbidden('API key expired');
  if (apiKey.tenantId !== tenant.id) {
    // A valid key pointed at the wrong host is a real config error worth logging.
    log.warn('api_key_tenant_mismatch', { prefix: parsed.prefix, hostTenant: tenant.slug });
    throw forbidden('API key does not belong to this tenant');
  }
  if (!verifySecret(parsed.secret, apiKey.secretHash, parsed.prefix)) {
    log.warn('api_key_bad_secret', { prefix: parsed.prefix });
    throw unauthorized('Invalid API key secret');
  }

  // Fire-and-forget usage stamp; never block the request on it.
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    tenant,
    apiKey,
    public: false,
    scopes: new Set(apiKey.scopes as Scope[]),
  };
}

export function requireScope(auth: AuthContext, scope: Scope): void {
  if (auth.public) throw forbidden(`Scope "${scope}" required`);
  if (!auth.scopes.has(scope)) throw forbidden(`Missing scope "${scope}"`);
}

export function parseCookie(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

/** Constant-time compare for admin session tokens. */
export function safeCompare(a: string, b: string): boolean {
  const ab = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ab, bb);
}