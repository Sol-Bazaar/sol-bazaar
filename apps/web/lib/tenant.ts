import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { resolveTenant, type TenantContext } from '@solbazaar/tenant';
import { resolveGeo, createLogger, type GeoResult } from '@solbazaar/core';

const log = createLogger({ service: 'geo' });

/**
 * Per-request tenant resolution.
 *
 * `cache()` from React dedupes this across every Server Component in a single
 * render pass, so a page with 40 product cards resolves the tenant and the
 * visitor's country exactly once instead of 41 times.
 */

export const getTenant = cache(async (): Promise<TenantContext> => {
  const h = await headers();
  const c = await cookies();

  return resolveTenant({
    host: h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000',
    tenantSlug: h.get('x-tenant-slug') ?? c.get('fc_tenant')?.value ?? null,
    baseDomain: process.env.BASE_DOMAIN ?? 'localhost:3000',
    houseSlug: process.env.HOUSE_TENANT_SLUG ?? 'sol-bazaar',
  });
});

/**
 * Resolve the visitor's country.
 *
 * Runs on the server so the *first* HTML response already contains only the
 * products legal for that market — no client-side flash of an unavailable card,
 * and no wasted image fetches for something we then refuse to sell.
 *
 * Disabled during static prerender, where there are no request headers.
 */
export const getGeo = cache(async (): Promise<GeoResult> => {
  const h = await headers();
  const c = await cookies();

  const timeoutMs = Number(process.env.GEO_LOOKUP_TIMEOUT_MS ?? 2500);
  const started = Date.now();

  const geo = await resolveGeo({
    headers: h,
    /*
     * `x-fc-country` is set by the edge middleware, which resolves
     * `?country=XX` > cookie > CDN header and forwards the winner. Passing it as
     * `queryCountry` matters: without it this function only ever saw the cookie,
     * so a *first* visit to `/?country=DE` fell through to IP lookup and then to
     * the tenant default — the landing page silently showed US stock regardless
     * of the region in the URL.
     *
     * The cookie is still passed as `cookieCountry` because middleware does not
     * run for statically-served asset requests, and `resolveGeo` prefers the
     * query value anyway, so the precedence here matches the middleware exactly.
     */
    queryCountry: h.get('x-fc-country'),
    cookieCountry: c.get('fc_country')?.value ?? null,
    tenantDefault: (await getTenantSafe()).defaultCountry,
    doIpLookup: process.env.GEO_IP_LOOKUP !== 'false',
    timeoutMs,
  });

  /*
   * Geo detection is the one place where "it silently did the wrong thing" is a
   * real product bug: a German visitor seeing US stock, priced in dollars, with
   * no error anywhere. So log the source every time it was *not* free (an IP
   * lookup or a fall-through), which is exactly when it is worth investigating.
   */
  const ms = Date.now() - started;
  if (geo.source === 'ip') {
    log.info('geo_detected', { country: geo.country, source: geo.source, ms });
  } else if (geo.source === 'tenant' || geo.source === 'fallback') {
    log.warn('geo_detection_degraded', {
      country: geo.country,
      source: geo.source,
      ms,
      hint:
        geo.source === 'tenant'
          ? 'no geo header and IP lookup did not resolve — put a CDN in front (Cloudflare/Vercel/Fly) or check GEO_LOOKUP_TIMEOUT_MS'
          : 'nothing resolved at all; set a tenant defaultCountry',
    });
  }

  return geo;
});

async function getTenantSafe(): Promise<Pick<TenantContext, 'defaultCountry'>> {
  try {
    return await getTenant();
  } catch {
    return { defaultCountry: 'US' };
  }
}

/** Country override propagated from `?country=XX` by middleware. */
export async function getCountryFromQuery(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get('x-fc-country') ?? null;
  } catch {
    return null;
  }
}

export async function assertTenantUsable(): Promise<void> {
  const t = await getTenant();
  if (t.status !== 'ACTIVE') {
    const { AppError } = await import('@solbazaar/core');
    throw new AppError('forbidden', `Store "${t.name}" is ${t.status.toLowerCase()}`);
  }
}