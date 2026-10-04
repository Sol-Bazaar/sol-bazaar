/**
 * Tenant resolution for white-label storefronts.
 *
 * Host resolution order:
 *   1. `?tenant=` / `x-tenant-slug` header (API partners / preview mode)
 *   2. Custom domain match on Domain.hostname (verified)
 *   3. Subdomain on the platform base domain (`acme.solbazaar.com`)
 *   4. `fc_tenant` cookie (sticky resolution behind proxies that mangle Host)
 *   5. The platform's own house tenant (the Sol Bazaar storefront itself)
 *
 * Tenant context is cached per-process for a short TTL because it is read on
 * every single request.
 */
import { prisma, type Tenant } from '@solbazaar/db';
import Decimal from 'decimal.js';
import { createLogger } from '@solbazaar/core';

const log = createLogger({ service: 'tenant' });

export interface BrandConfig {
  name?: string;
  legalName?: string;
  logoText?: string;
  logoUrl?: string;
  faviconUrl?: string;
  tagline?: string;
  supportEmail?: string;
  supportUrl?: string;
  accent?: string; // e.g. '#FFFFFF' — the house default is colourless
  accent2?: string; // e.g. '#F5F2EC'
  heroHeadline?: string;
  heroSubhead?: string;
  announcement?: string;
  social?: { x?: string; telegram?: string; discord?: string; instagram?: string };
}

export interface ThemeConfig {
  mode?: 'dark' | 'light';
  fontHeading?: string;
  fontBody?: string;
  radius?: number; // px, card corner radius
  glow?: boolean;
  layout?: 'grid' | 'list';
}

export interface FeatureFlags {
  hidePrices?: boolean;
  requireEmailVerify?: boolean;
  showCryptoPicker?: boolean;
  allowedTokens?: string[];
  autoRefundsOnUnderpayment?: boolean;
  maintenance?: boolean;
}

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  status: Tenant['status'];
  legalName: string | null;
  supportEmail: string | null;
  defaultCountry: string;
  markupBps: number;
  minOrderUsd: Decimal;
  maxOrderUsd: Decimal;
  orderTtlMinutes: number;
  acceptedTokens: string[];
  brand: BrandConfig;
  theme: ThemeConfig;
  features: FeatureFlags;
  host: string;
  isHouseTenant: boolean;
}

// ---------------------------------------------------------------------------
// Host parsing
// ---------------------------------------------------------------------------

export function stripPort(host: string): string {
  return host.split(':')[0].toLowerCase().trim();
}

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'dashboard', 'cdn', 'static', 'assets', 'docs', 'status', 'mail', 'dev', 'staging']);

export function slugFromHost(host: string, baseDomain: string): string | null {
  const h = stripPort(host);
  const base = stripPort(baseDomain);
  if (!h || h === base) return null;
  if (!h.endsWith(`.${base}`)) return null;
  const sub = h.slice(0, -(base.length + 1)).split('.')[0];
  if (!sub || RESERVED_SUBDOMAINS.has(sub)) return null;
  return sub.replace(/[^a-z0-9-]/g, '');
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  ctx: TenantContext;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = Number(process.env.TENANT_CACHE_TTL_MS ?? 30_000);

function toContext(t: Tenant, host: string, houseSlug: string): TenantContext {
  const brand = (t.brand ?? {}) as BrandConfig;
  const theme = (t.theme ?? {}) as ThemeConfig;
  const features = (t.features ?? {}) as FeatureFlags;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    legalName: t.legalName,
    supportEmail: t.supportEmail,
    defaultCountry: t.defaultCountry,
    markupBps: t.markupBps,
    minOrderUsd: new Decimal(String(t.minOrderUsd)),
    maxOrderUsd: new Decimal(String(t.maxOrderUsd)),
    orderTtlMinutes: t.orderTtlMinutes,
    acceptedTokens: (t.acceptedTokens ?? ['SOL']).map(String),
    brand,
    theme,
    features,
    host,
    isHouseTenant: t.slug === houseSlug,
  };
}

export function invalidateTenantCache(slugOrId?: string): void {
  if (!slugOrId) return cache.clear();
  for (const k of cache.keys()) if (k.includes(slugOrId)) cache.delete(k);
}

/**
 * Convert a raw Prisma `Tenant` row into a `TenantContext`.
 *
 * The REST layer already has the full row in hand (it fetched it to validate
 * the API key), so re-resolving through the cache would be wasteful.
 */
export function tenantToContext(
  t: Tenant,
  host = t.slug,
  houseSlug = process.env.HOUSE_TENANT_SLUG ?? 'sol-bazaar',
): TenantContext {
  return toContext(t, host, houseSlug);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolveArgs {
  host: string;
  tenantSlug?: string | null;
  cookieSlug?: string | null;
  baseDomain?: string;
  houseSlug?: string;
}

export async function resolveTenant(args: ResolveArgs): Promise<TenantContext> {
  const baseDomain = args.baseDomain ?? process.env.BASE_DOMAIN ?? 'localhost:3000';
  const houseSlug = args.houseSlug ?? process.env.HOUSE_TENANT_SLUG ?? 'sol-bazaar';
  const host = stripPort(args.host);

  // Explicit overrides first — these bypass DNS entirely.
  const explicit = cleanSlug(args.tenantSlug) ?? cleanSlug(args.cookieSlug);
  if (explicit) {
    const bySlug = await loadBySlug(explicit);
    if (bySlug) return bySlug;
    if (explicit !== houseSlug) log.warn('tenant_slug_not_found', { slug: explicit, host });
  }

  // 1. Custom domain
  const byDomain = await loadByDomain(host);
  if (byDomain) return byDomain;

  // 2. Subdomain
  const sub = slugFromHost(host, baseDomain);
  if (sub) {
    const bySub = await loadBySlug(sub);
    if (bySub) return bySub;
    log.warn('tenant_subdomain_not_found', { subdomain: sub, host });
  }

  // 3. House tenant
  const house = await loadBySlug(houseSlug);
  if (house) return house;

  throw new Error(
    `No tenant could be resolved for host "${host}". Seed the database (npm run db:seed) or check BASE_DOMAIN / HOUSE_TENANT_SLUG.`,
  );
}

function cleanSlug(v?: string | null): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return s.length >= 2 && s.length <= 40 ? s : null;
}

async function loadBySlug(slug: string): Promise<TenantContext | null> {
  const key = `slug:${slug}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.ctx;
  try {
    const t = await prisma.tenant.findUnique({ where: { slug } });
    if (!t) return null;
    const ctx = toContext(t, t.slug, process.env.HOUSE_TENANT_SLUG ?? 'sol-bazaar');
    cache.set(key, { ctx, expiresAt: Date.now() + TTL_MS });
    return ctx;
  } catch (e) {
    log.error('tenant_lookup_failed', { slug, err: (e as Error).message });
    return null;
  }
}

async function loadByDomain(hostname: string): Promise<TenantContext | null> {
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return null;
  const key = `host:${hostname}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.ctx;

  try {
    const domain = await prisma.domain.findUnique({
      where: { hostname },
      include: { tenant: true },
    });
    // Unverified domains still resolve (useful for DNS-pending launch) but are
    // flagged so the UI can warn the operator.
    const t = domain?.tenant;
    if (!t) return null;
    const ctx = toContext(t, hostname, process.env.HOUSE_TENANT_SLUG ?? 'sol-bazaar');
    cache.set(key, { ctx, expiresAt: Date.now() + TTL_MS });
    if (!domain?.verifiedAt) log.warn('tenant_domain_unverified', { hostname });
    return ctx;
  } catch (e) {
    log.error('domain_lookup_failed', { hostname, err: (e as Error).message });
    return null;
  }
}

export function isTenantActive(ctx: TenantContext): boolean {
  return ctx.status === 'ACTIVE';
}