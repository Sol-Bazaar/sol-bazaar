/**
 * Catalog read layer.
 *
 * Two rules drive the shape of these queries:
 *
 *  1. **Geo availability is a hard filter, not a soft flag.** `listProducts`
 *     only ever returns products we are actually allowed to sell into the
 *     visitor's market. This is enforced in SQL-ish terms via the availability
 *     rules loaded per product, because a country list per product does not
 *     translate cleanly to a Prisma `where`.
 *
 *  2. **Tenant scope = global catalog + tenant overrides.** A merchant can hide,
 *     re-price or pin any global product without forking it, so adding a
 *     merchant never requires duplicating the catalogue.
 */
import Decimal from 'decimal.js';
import { prisma, ProductScope, type Product, type Prisma } from '@solbazaar/db';
import { isAvailableInCountry, slugify, scopeKey, createLogger, convertFromUsd, formatMoney, roundForDisplay, type FxRates } from '@solbazaar/core';

const log = createLogger({ service: 'catalog' });

/**
 * Local-currency display inputs.
 *
 * Passed in rather than imported so this module stays free of I/O for pricing —
 * the rate fetch lives in `lib/fx.ts` and the caller decides when it happens.
 */
export interface DisplayArgs {
  currency: string;
  /** "Units per USD". */
  rates: FxRates;
  /** The rate actually applied, snapshotted onto orders. */
  rate: number;
}

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  description: string;
  logoUrl: string | null;
  accent: string | null;
  category: { id: string; slug: string; name: string; icon: string | null; accent: string | null; group: string | null; description: string | null };
  brand: { id: string; slug: string; name: string; logoUrl: string | null } | null;
  currency: string;
  priceFromUsd: number;
  priceToUsd: number;
  /**
   * Local-currency view of `priceFromUsd`, already rounded to the currency's
   * minor units. `null` when the visitor's currency is USD, in which case the UI
   * shows `priceFromUsd` and there is nothing extra to render.
   *
   * Pre-formatted on the server deliberately: it keeps `Intl` locale rules and
   * `decimal.js` off the client, and guarantees every card on a page formats
   * identically regardless of where it was rendered.
   */
  displayCurrency: string | null;
  displayPriceFrom: string | null;
  displayRate: number;
  minFaceValue: number | null;
  denominations: {
    faceValue: string;
    currency: string;
    priceUsd: string;
    /** Local-currency price, pre-formatted. `null` when showing USD. */
    priceDisplay: string | null;
    available: boolean;
  }[];
  inStock: boolean;
  stock: number;
  isFeatured: boolean;
  tags: string[];
  rating: number | null;
  reviewCount: number;
  sortOrder: number;
  scope: 'GLOBAL' | 'TENANT';
  /** Populated by the search endpoint only. */
  relevance?: number;
}

export interface ListArgs {
  tenantId: string;
  country: string;
  markupBps: number;
  /**
   * Local-currency display context. Optional so the REST API and internal callers
   * can keep working in pure USD; when present every price also carries a
   * pre-formatted local equivalent.
   */
  display?: DisplayArgs;
  query?: {
    category?: string;
    brand?: string;
    q?: string;
    minPrice?: number;
    maxPrice?: number;
    featured?: boolean;
    sort?: 'relevance' | 'price_asc' | 'price_desc' | 'name' | 'newest' | 'popular';
    limit?: number;
    cursor?: string;
  };
}

export async function listCategories(tenantId: string, country: string) {
  const [cats, regions] = await Promise.all([listCategoryRows(tenantId), loadRegions()]);
  const products = await prisma.product.findMany({
    where: { isActive: true, scope: { in: [ProductScope.GLOBAL, ProductScope.TENANT] }, ...(tenantId ? { OR: [{ scope: ProductScope.GLOBAL }, { tenantId }] } : {}) },
    select: { categoryId: true, regions: { select: { regionCode: true, countryCode: true } } },
  });

  const counts = new Map<string, number>();
  for (const p of products) {
    if (!isAvailableInCountry(p.regions, country, regions)) continue;
    counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  }

  return cats
    .map((c) => ({ ...c, productCount: counts.get(c.id) ?? 0 }))
    .filter((c) => c.productCount > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function listCategoryRows(tenantId: string) {
  const rows = await prisma.category.findMany({
    where: {
      isActive: true,
      ...(tenantId ? { OR: [{ scope: ProductScope.GLOBAL }, { tenantId }] } : {}),
    },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    icon: c.icon,
    accent: c.accent,
    description: c.description,
    group: c.group,
    sortOrder: c.sortOrder,
  }));
}

export async function loadRegions() {
  const rows = await prisma.region.findMany({ where: { isActive: true } });
  return rows.map((r) => ({ code: r.code, name: r.name, countries: r.countries }));
}

export async function listProducts(args: ListArgs): Promise<{ products: CatalogProduct[]; nextCursor: string | null; total: number }> {
  const q = args.query ?? {};
  const limit = Math.min(q.limit ?? 24, 100);
  const regions = await loadRegions();

  // Explicitly typed rather than `as const`: Prisma needs a mutable
  // ProductWhereInput, and `as const` makes the OR arrays readonly.
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    scope: { in: [ProductScope.GLOBAL, ProductScope.TENANT] },
    OR: [{ scope: ProductScope.GLOBAL }, { tenantId: args.tenantId }],
    ...(q.category && q.category !== 'all'
      ? { category: { OR: [{ scope: ProductScope.GLOBAL, slug: q.category }, { tenantId: args.tenantId, slug: q.category }] } }
      : {}),
    ...(q.brand ? { brand: { slug: q.brand } } : {}),
    ...(q.featured ? { isFeatured: true } : {}),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { shortName: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
            { tags: { has: q.q.toLowerCase() } },
            { brand: { name: { contains: q.q, mode: 'insensitive' } } },
            // Searching a category name ("vpn", "gaming") should surface its cards.
            { category: { name: { contains: q.q, mode: 'insensitive' } } },
            { category: { slug: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const rows = await prisma.product.findMany({
    where,
    include: {
      category: true,
      brand: true,
      denominations: { where: { isActive: true }, orderBy: [{ faceValue: 'asc' }] },
      regions: { select: { regionCode: true, countryCode: true } },
    },
    take: limit + 1,
    orderBy: sortOrderFor(q.sort),
  });

  const overrides = await prisma.tenantCatalogOverride.findMany({
    where: { tenantId: args.tenantId },
    select: { productId: true, isHidden: true, isPinned: true, priceBpsAdjust: true, sortBoost: true },
  });
  const overrideMap = new Map(overrides.map((o) => [o.productId, o]));
  const hidden = new Set(overrides.filter((o) => o.isHidden).map((o) => o.productId));

  let products = rows
    .filter((p) => !hidden.has(p.id))
    .filter((p) => isAvailableInCountry(p.regions, args.country, regions))
    .map((p) => toCatalogProduct(p, args.markupBps, overrideMap.get(p.id)?.priceBpsAdjust ?? 0, args.display));

  // Tenant-pinned products float to the top; keep the requested sort inside
  // each pinned/unpinned group.
  const pinned = (id: string) => (overrideMap.get(id)?.isPinned ? 1 : 0);
  products.sort((a, b) => {
    const p = pinned(b.id) - pinned(a.id);
    if (p !== 0) return p;
    return sortProducts(a, b, q.sort);
  });

  // Price filters apply after pricing, since the price is derived from the
  // tenant's markup rather than stored per tenant.
  if (q.minPrice != null) products = products.filter((p) => p.priceFromUsd >= q.minPrice!);
  if (q.maxPrice != null) products = products.filter((p) => p.priceFromUsd <= q.maxPrice!);

  const hasMore = rows.length > limit;
  const page = products.slice(0, limit);

  log.debug('list_products', { country: args.country, returned: page.length, filtered: rows.length - products.length });

  return {
    products: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    total: products.length,
  };
}

function sortOrderFor(sort?: string): any[] {
  switch (sort) {
    case 'name':
      return [{ sortOrder: 'asc' }, { name: 'asc' }];
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'popular':
      return [{ isFeatured: 'desc' }, { reviewCount: 'desc' }];
    default:
      return [{ isFeatured: 'desc' }, { sortOrder: 'asc' }];
  }
}

function sortProducts(a: CatalogProduct, b: CatalogProduct, sort?: string): number {
  switch (sort) {
    case 'price_asc':
      return a.priceFromUsd - b.priceFromUsd;
    case 'price_desc':
      return b.priceFromUsd - a.priceFromUsd;
    case 'name':
      return a.name.localeCompare(b.name);
    case 'newest':
      return 0;
    default:
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  }
}

type ProductWithRelations = Product & {
  category: {
    id: string;
    slug: string;
    name: string;
    icon: string | null;
    accent: string | null;
    group: string | null;
    description: string | null;
  };
  brand: { id: string; slug: string; name: string; logoUrl: string | null } | null;
  denominations: { faceValue: unknown; currency: string; priceUsd: unknown; isActive: boolean }[];
};

export function toCatalogProduct(
  p: ProductWithRelations,
  markupBps: number,
  priceBpsAdjust = 0,
  display?: DisplayArgs,
): CatalogProduct {
  const extra = markupBps + priceBpsAdjust;
  // Only do conversion work when there is something to convert. USD visitors
  // take the original path with zero extra arithmetic.
  const showLocal = Boolean(display && display.currency !== 'USD');

  const denoms = (p.denominations ?? [])
    .filter((d) => d.isActive)
    .map((d) => {
      const base = new Decimal(String(d.priceUsd));
      const adj = extra === 0 ? base : base.mul(new Decimal(1).plus(new Decimal(extra).div(10000)));
      return {
        faceValue: new Decimal(String(d.faceValue)).toFixed(2),
        currency: d.currency,
        priceUsd: adj.toFixed(2),
        priceDisplay: showLocal
          ? formatMoney(roundForDisplay(convertFromUsd(adj, display!.currency, display!.rates), display!.currency), display!.currency)
          : null,
        available: true,
      };
    })
    .sort((a, b) => Number(a.faceValue) - Number(b.faceValue));

  const prices = denoms.map((d) => Number(d.priceUsd));
  const stock = Math.max(0, p.totalStock - p.reservedStock);
  const trackStock = (p as any).trackStock !== false;
  const lowest = denoms.length ? new Decimal(denoms[0].priceUsd) : new Decimal(0);

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    shortName: p.shortName ?? null,
    description: p.description,
    logoUrl: p.logoUrl ?? p.brand?.logoUrl ?? null,
    accent: p.accent ?? null,
    category: {
      id: p.category.id,
      slug: p.category.slug,
      name: p.category.name,
      icon: p.category.icon,
      accent: p.category.accent,
      group: p.category.group,
      description: p.category.description,
    },
    brand: p.brand ? { id: p.brand.id, slug: p.brand.slug, name: p.brand.name, logoUrl: p.brand.logoUrl } : null,
    currency: p.defaultCurrency,
    priceFromUsd: prices.length ? Math.min(...prices) : 0,
    priceToUsd: prices.length ? Math.max(...prices) : 0,
    displayCurrency: showLocal ? display!.currency : null,
    displayPriceFrom: showLocal
      ? formatMoney(
          roundForDisplay(convertFromUsd(lowest, display!.currency, display!.rates), display!.currency),
          display!.currency,
        )
      : null,
    displayRate: showLocal ? display!.rate : 1,
    minFaceValue: denoms.length ? Math.min(...denoms.map((d) => Number(d.faceValue))) : null,
    denominations: denoms,
    inStock: trackStock ? stock > 0 : true,
    stock,
    isFeatured: p.isFeatured,
    tags: p.tags ?? [],
    rating: p.rating ? Number(p.rating) : null,
    reviewCount: p.reviewCount,
    sortOrder: p.sortOrder,
    scope: p.scope,
  };
}

/** Single product, still honouring the geo + tenant rules. */
export async function getProduct(args: { tenantId: string; slug: string; country: string; markupBps: number }): Promise<CatalogProduct | null> {
  const regions = await loadRegions();
  const p = await prisma.product.findFirst({
    where: {
      slug: args.slug,
      isActive: true,
      OR: [{ scope: ProductScope.GLOBAL }, { tenantId: args.tenantId }],
    },
    include: {
      category: true,
      brand: true,
      denominations: { where: { isActive: true }, orderBy: [{ faceValue: 'asc' }] },
      regions: { select: { regionCode: true, countryCode: true } },
    },
  });
  if (!p) return null;
  if (!isAvailableInCountry(p.regions, args.country, regions)) return null;

  const ov = await prisma.tenantCatalogOverride.findUnique({
    where: { tenantId_productId: { tenantId: args.tenantId, productId: p.id } },
  });
  if (ov?.isHidden) return null;

  return toCatalogProduct(p, args.markupBps, ov?.priceBpsAdjust ?? 0);
}

/** Landing-page highlights: featured + a deterministic "popular" spread. */
export async function getFeatured(tenantId: string, country: string, markupBps: number, take = 12): Promise<CatalogProduct[]> {
  const { products } = await listProducts({
    tenantId,
    country,
    markupBps,
    query: { featured: true, limit: take },
  });
  if (products.length >= take) return products;

  const filler = await listProducts({
    tenantId,
    country,
    markupBps,
    query: { sort: 'popular', limit: take + products.length },
  });
  const seen = new Set(products.map((p) => p.id));
  return [...products, ...filler.products.filter((p) => !seen.has(p.id))].slice(0, take);
}
