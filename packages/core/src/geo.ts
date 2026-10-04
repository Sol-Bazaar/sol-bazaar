/**
 * Geo resolution + product-availability matching.
 *
 * Priority (first hit wins):
 *   1. Explicit `?country=` query / cookie (user override)
 *   2. CDN geo header (Cloudflare `CF-IPCountry`, Fly `Fly-Client-IP`-style,
 *      Vercel `x-vercel-ip-country`, nginx `X-Geo-Country`)
 *   3. IP geolocation lookup (ipapi.co by default)
 *   4. Tenant default country
 *
 * Matching rules (in order): exact country -> region containing country -> GLOBAL.
 * A product with no RegionAvailability rows is treated as worldwide.
 */

export const GLOBAL = 'GLOBAL';

export interface GeoResult {
  country: string; // ISO-3166-1 alpha-2, uppercase
  source: 'query' | 'cookie' | 'cdn' | 'ip' | 'tenant' | 'fallback';
  region?: string;
  ip?: string;
}

/** Headers various CDNs use to tell the origin the visitor's country. */
const CDN_HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'fly-client-country', // Fly.io
  'x-geo-country', // generic
  'x-country-code',
  'cloudfront-viewer-country', // AWS CloudFront
];

export function countryFromHeaders(headers: Headers | Record<string, string | string[] | undefined>): GeoResult | null {
  const get = (k: string) => {
    if (headers instanceof Headers) return headers.get(k);
    const v = headers[k] ?? headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  for (const h of CDN_HEADERS) {
    const v = get(h);
    if (!v) continue;
    const code = normaliseCountry(v);
    // Cloudflare sends "XX" / "T1" for unknown / Tor
    if (code && code !== 'XX' && code !== 'T1') return { country: code, source: 'cdn' };
  }
  return null;
}

export function normaliseCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (code === 'XX' || code === 'T1' || code === 'ZZ') return null;
  return code;
}

/** Cheap RFC1918 / loopback guard so we never leak localhost lookups upstream. */
export function isPrivateIp(ip: string): boolean {
  return (
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fc') || // unique-local IPv6
    ip.startsWith('fd') ||
    ip === '::'
  );
}

export function clientIpFromHeaders(headers: Headers | Record<string, string | undefined>): string | null {
  const get = (k: string) => {
    if (headers instanceof Headers) return headers.get(k);
    const v = headers[k] ?? headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const fwd = get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = get('x-real-ip');
  if (real) return real.trim();
  return get('cf-connecting-ip')?.trim() ?? null;
}

export type GeoProvider = 'ipwho' | 'country-is' | 'ip-api';

export interface GeoLookupOptions {
  fallbackCountry?: string;
  timeoutMs?: number;
  providers?: GeoProvider[];
}

/**
 * IP -> country providers, tried in order.
 *
 * Each declares its own URL *and* its own parser, because they disagree on
 * shape: `ipwho.is` nests under `country_code`, `country.is` uses a flat
 * `country`, and `ip-api.com` calls it `countryCode`. Parsing them generically
 * is how you end up shipping a resolver that silently returns null.
 *
 * All three are free and keyless. They are rate-limited, which is the whole
 * reason for the cache below rather than a single provider.
 */
const PROVIDERS: Array<{ id: GeoProvider; url: (ip: string) => string; parse: (t: string) => string | null }> = [
  {
    id: 'ipwho',
    url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}`,
    parse: (t) => {
      const j = JSON.parse(t) as { success?: boolean; country_code?: string };
      return j.success === false ? null : (j.country_code ?? null);
    },
  },
  {
    id: 'country-is',
    url: (ip) => `https://api.country.is/${encodeURIComponent(ip)}`,
    parse: (t) => (JSON.parse(t) as { country?: string }).country ?? null,
  },
  {
    id: 'ip-api',
    // HTTP, not HTTPS: that is the free tier's limit. It is only reached if the
    // two HTTPS providers above both fail.
    url: (ip) => `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
    parse: (t) => {
      const j = JSON.parse(t) as { status?: string; countryCode?: string };
      return j.status === 'success' ? (j.countryCode ?? null) : null;
    },
  },
];

/**
 * Short-lived cache, keyed by IP.
 *
 * Without it every server render for an uncached visitor is a third-party HTTP
 * request, and the free tiers here rate-limit aggressively — a busy storefront
 * would start getting 429s from all three and fall through to the tenant
 * default, which looks exactly like "IP detection is broken".
 *
 * Failures are cached too, but briefly: we do not want a hard-down provider
 * retried on every single render.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const cache = new Map<string, { code: string | null; at: number }>();

/** Test seam. */
export function __clearGeoCache(): void {
  cache.clear();
}

/**
 * Default budget for the whole lookup.
 *
 * These are free community endpoints and their latency is genuinely variable —
 * measured 0.6s to 3.4s for the same query minutes apart. A tight budget looks
 * like "IP detection is broken" on a slow day, which is worse than a slightly
 * slower first paint.
 *
 * Since providers are raced, this is the *worst* case, not the typical one: the
 * answer arrives as soon as the fastest provider replies, and in practice that
 * is ~1s. It is only paid once per visitor, because the result is written to the
 * `fc_country` cookie and every later request skips this entirely.
 *
 * Override with `GEO_LOOKUP_TIMEOUT_MS`.
 */
const DEFAULT_TIMEOUT_MS = 2500;

/**
 * Best-effort IP -> country.
 *
 * Never throws: returns null on any failure so the caller falls through to the
 * tenant default rather than erroring the page render.
 *
 * Providers are raced, not sequenced. Sequentially, three providers at their
 * timeout each means minutes of added latency on a slow day. Racing them means
 * the answer arrives as soon as the *fastest* one replies, and a slow provider
 * costs nothing but a wasted request.
 */
export async function lookupCountryByIp(
  ip: string,
  opts: GeoLookupOptions = {},
): Promise<string | null> {
  if (!ip || isPrivateIp(ip)) return null;

  const hit = cache.get(ip);
  if (hit) {
    const ttl = hit.code ? CACHE_TTL_MS : FAILURE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.code;
  }

  const want = opts.providers ?? PROVIDERS.map((p) => p.id);
  const active = want.map((id) => PROVIDERS.find((x) => x.id === id)).filter(Boolean) as typeof PROVIDERS;
  if (!active.length) return null;

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const attempt = async (p: (typeof PROVIDERS)[number]): Promise<string | null> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(p.url(ip), { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      return normaliseCountry(p.parse(await res.text()));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  /*
   * First valid answer wins; every other request is abandoned rather than
   * awaited. `Promise.any` rejects only once all of them have settled, so one
   * provider throwing cannot mask a success from another.
   *
   * No logging here: this module is also exported from the browser barrel, and
   * importing the logger would pull `process` into a client bundle. Diagnostics
   * live in `apps/web/lib/tenant.ts`, which is server-only.
   */
  let code: string | null = null;
  try {
    code = await Promise.any(active.map(attempt));
  } catch {
    code = null;
  }

  cache.set(ip, { code, at: Date.now() });
  return code;
}

export async function resolveGeo(args: {
  headers: Headers | Record<string, string | undefined>;
  queryCountry?: string | null;
  cookieCountry?: string | null;
  tenantDefault?: string | null;
  doIpLookup?: boolean;
  /** Override the per-request IP-lookup budget. */
  timeoutMs?: number;
}): Promise<GeoResult> {
  const q = normaliseCountry(args.queryCountry);
  if (q) return { country: q, source: 'query' };

  const c = normaliseCountry(args.cookieCountry);
  if (c) return { country: c, source: 'cookie' };

  const cdn = countryFromHeaders(args.headers);
  if (cdn) return cdn;

  if (args.doIpLookup !== false) {
    const ip = clientIpFromHeaders(args.headers);
    const hit = await lookupCountryByIp(ip ?? '', { timeoutMs: args.timeoutMs });
    if (hit) return { country: hit, source: 'ip', ...(ip ? { ip } : {}) };
  }

  const t = normaliseCountry(args.tenantDefault);
  if (t) return { country: t, source: 'tenant' };

  return { country: 'US', source: 'fallback' };
}

// ---------------------------------------------------------------------------
// Availability matching
// ---------------------------------------------------------------------------

export interface AvailabilityRule {
  regionCode: string;
  countryCode?: string | null;
}

/**
 * Decide if a product (with `rules`) is sellable in `country` within `regions`.
 *
 * `rules` empty  -> worldwide.
 * rule.countryCode === country -> match (most specific).
 * rule.regionCode === GLOBAL or contains country -> match.
 */
export function isAvailableInCountry(
  rules: readonly AvailabilityRule[],
  country: string,
  regions: readonly { code: string; countries: string[] }[] = [],
): boolean {
  if (!rules || rules.length === 0) return true;
  const cc = country.toUpperCase();

  // Exact country pin wins
  if (rules.some((r) => r.countryCode && r.countryCode.toUpperCase() === cc)) return true;

  const regionOfCountry = regions.find((r) => (r.countries ?? []).map((x) => x.toUpperCase()).includes(cc));
  const regionCode = regionOfCountry?.code;

  const hasWildcard =
    rules.some((r) => (r.regionCode ?? '').toUpperCase() === GLOBAL) ||
    (!!regionCode && rules.some((r) => (r.regionCode ?? '').toUpperCase() === regionCode.toUpperCase()));

  return hasWildcard;
}

/** Human labels for the country picker in the storefront header. */
export const TOP_COUNTRIES = [
  { code: 'US', label: 'United States', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'GB', label: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'CA', label: 'Canada', flag: '\u{1F1E8}\u{1F1E6}' },
  { code: 'AU', label: 'Australia', flag: '\u{1F1E6}\u{1F1FA}' },
  { code: 'DE', label: 'Germany', flag: '\u{1F1E9}\u{1F1EA}' },
  { code: 'FR', label: 'France', flag: '\u{1F1EB}\u{1F1F7}' },
  { code: 'NL', label: 'Netherlands', flag: '\u{1F1F3}\u{1F1F1}' },
  { code: 'ES', label: 'Spain', flag: '\u{1F1EA}\u{1F1F8}' },
  { code: 'IT', label: 'Italy', flag: '\u{1F1EE}\u{1F1F9}' },
  { code: 'AE', label: 'United Arab Emirates', flag: '\u{1F1E6}\u{1F1EA}' },
  { code: 'SG', label: 'Singapore', flag: '\u{1F1F8}\u{1F1EC}' },
  { code: 'BR', label: 'Brazil', flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'IN', label: 'India', flag: '\u{1F1EE}\u{1F1F3}' },
  { code: 'JP', label: 'Japan', flag: '\u{1F1EF}\u{1F1F5}' },
  { code: 'MX', label: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}' },
  { code: 'NZ', label: 'New Zealand', flag: '\u{1F1F3}\u{1F1FF}' },
] as const;

export function countryLabel(code: string): string {
  const hit = TOP_COUNTRIES.find((c) => c.code === code.toUpperCase());
  if (hit) return hit.label;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}