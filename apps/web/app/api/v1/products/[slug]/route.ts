import { handler, jsonOk, enforceRateLimit } from '@/lib/api';
import { authenticate } from '@/lib/api-auth';
import { getProduct, loadRegions } from '@/lib/catalog';
import { resolveGeo, isAvailableInCountry, notFound } from '@solbazaar/core';

export const dynamic = 'force-dynamic';

export interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/v1/products/:slug
 *
 * A single product with every denomination, geo-checked against the caller's
 * market. Returns 404 (not 403) when the product exists but is not sellable in
 * that country, so the endpoint does not leak the existence of restricted SKUs.
 */
export const GET = handler(async (req: Request, ctx: RouteContext) => {
  const { slug } = await ctx.params;
  const auth = await authenticate(req);
  const rateLimit = await enforceRateLimit(req, auth.apiKey?.rateLimitPerMin);

  const geo = await resolveGeo({
    headers: req.headers,
    doIpLookup: process.env.GEO_IP_LOOKUP !== 'false',
  });

  const regions = await loadRegions();
  const product = await getProduct({
    tenantId: auth.tenant.id,
    slug,
    country: geo.country,
    markupBps: auth.tenant.markupBps,
  });

  if (!product) {
    const raw = await getProductUnfiltered(auth.tenant.id, slug, regions, geo.country);
    throw notFound(
      raw ? `${raw} is not available in ${geo.country}` : `Product "${slug}" not found`,
    );
  }

  return jsonOk(product, { req, meta: { rateLimit, geo: { country: geo.country, source: geo.source } } });
});

async function getProductUnfiltered(tenantId: string, slug: string, regions: any[], country: string): Promise<string | null> {
  const { prisma, ProductScope } = await import('@solbazaar/db');
  const p = await prisma.product.findFirst({
    where: { slug, OR: [{ scope: ProductScope.GLOBAL }, { tenantId }] },
    include: { regions: { select: { regionCode: true, countryCode: true } } },
  });
  if (!p) return null;
  return isAvailableInCountry(p.regions, country, regions) ? p.name : null;
}