import { handler, jsonOk, parseQuery, enforceRateLimit } from '@/lib/api';
import { authenticate } from '@/lib/api-auth';
import { catalogQuerySchema, resolveGeo, clientIpFromHeaders, createLogger } from '@solbazaar/core';
import { listProducts, listCategories } from '@/lib/catalog';
import { getDisplayContext, getFxRates } from '@/lib/fx';
import { getPriceBoard } from '@/lib/pricing';

const log = createLogger({ service: 'api:catalog' });

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/catalog
 *
 * Public (host-scoped) catalogue for white-label partners.
 *
 * Products are filtered by the caller's country — inferred from `?country=`, the
 * `CF-IPCountry`-style header, or IP geolocation — so a partner in Germany
 * never receives US-only gift cards they are not allowed to sell.
 *
 * Auth: none required, but an `Authorization: Bearer` key raises the rate limit.
 *
 * Query:
 *   country    ISO-3166-1 alpha-2. Overrides geo detection.
 *   category   category slug
 *   brand      brand slug
 *   q          free-text search over name / description / tags
 *   minPrice,maxPrice  USD bounds on the cheapest denomination
 *   featured   true to restrict to featured products
 *   sort       relevance | price_asc | price_desc | name | newest | popular
 *   limit      1..100 (default 24)
 */
export const GET = handler(async (req: Request) => {
  const q = parseQuery(req.url, catalogQuerySchema);
  const auth = await authenticate(req);
  const rateLimit = await enforceRateLimit(req, auth.apiKey?.rateLimitPerMin);

  const geo = await resolveGeo({
    headers: req.headers,
    queryCountry: q.country,
    doIpLookup: process.env.GEO_IP_LOOKUP !== 'false',
  });

  /*
   * Local-currency display.
   *
   * The API always returns canonical USD (`priceUsd` / `priceFromUsd`) because
   * that is what an order settles against — partners must not compute a crypto
   * amount from a converted figure. Alongside it we include the pre-formatted
   * local view so a partner rendering a storefront doesn't have to reimplement
   * rounding, minor units and locale formatting.
   */
  const rates = await getFxRates();
  const displayCtx = await getDisplayContext(geo.country);

  const [products, categories, priceBoard] = await Promise.all([
    listProducts({
      tenantId: auth.tenant.id,
      country: geo.country,
      markupBps: auth.tenant.markupBps,
      display: { currency: displayCtx.currency, rates, rate: displayCtx.rate },
      query: {
        category: q.category,
        brand: q.brand,
        q: q.q,
        minPrice: q.minPrice,
        maxPrice: q.maxPrice,
        featured: q.featured,
        sort: q.sort,
        limit: q.limit,
        cursor: q.cursor,
      },
    }),
    listCategories(auth.tenant.id, geo.country),
    getPriceBoard(),
  ]);

  log.debug('catalog', { tenant: auth.tenant.slug, country: geo.country, count: products.products.length });

  return jsonOk(
    {
      tenant: { slug: auth.tenant.slug, name: auth.tenant.name, markupBps: auth.tenant.markupBps },
      country: geo.country,
      currency: 'USD',
      categories,
      priceBoard,
      products: products.products,
    },
    {
      req,
      meta: {
        rateLimit,
        pagination: { limit: q.limit, nextCursor: products.nextCursor },
        geo: { country: geo.country, source: geo.source },
        /*
         * Which currency the `display*` fields are in, and the rate behind them,
         * so a partner can label it rather than guess. `isFallback` is true when
         * no live rate existed and a static table was used — worth surfacing,
         * because a stale rate should not be presented as exact.
         */
        display: {
          currency: displayCtx.currency,
          rate: displayCtx.rate,
          isFallback: displayCtx.isFallback,
          fetchedAt: displayCtx.fetchedAt,
        },
      },
    },
  );
});