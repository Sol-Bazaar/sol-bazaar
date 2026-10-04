import { Suspense } from 'react';
import Link from 'next/link';
import { getTenant, getGeo } from '@/lib/tenant';
import { countryLabel } from '@solbazaar/core';
import { listProducts, listCategories } from '@/lib/catalog';
import { getDisplayContext, getFxRates } from '@/lib/fx';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ProductCard } from '@/components/ProductCard';
import { CatalogFilters } from '@/components/CatalogFilters';
import { SortSelect } from '@/components/SortSelect';
import { SearchBar } from '@/components/SearchBar';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'All gift cards' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const category = typeof sp.category === 'string' ? sp.category : undefined;
  const brand = typeof sp.brand === 'string' ? sp.brand : undefined;
  const sort = (typeof sp.sort === 'string' ? sp.sort : 'relevance') as any;
  const country = typeof sp.country === 'string' ? sp.country : undefined;

  const [tenant, geo] = await Promise.all([getTenant(), getGeo()]);
  const effectiveCountry = country ?? geo.country;

  /*
   * Resolve FX before fanning out. These are two cheap awaits (rates are cached
   * process-wide for 10 minutes), and doing them first keeps the display context
   * out of the same Promise.all that consumes it.
   */
  const rates = await getFxRates();
  const displayCtx = await getDisplayContext(effectiveCountry);

  const [categories, result] = await Promise.all([
    listCategories(tenant.id, effectiveCountry),
    listProducts({
      tenantId: tenant.id,
      country: effectiveCountry,
      markupBps: tenant.markupBps,
      display: { currency: displayCtx.currency, rates, rate: displayCtx.rate },
      query: { q, category, brand, sort, limit: 48 },
    }),
  ]);

  const heading = q
    ? `Results for “${q}”`
    : category
      ? categories.find((c) => c.slug === category)?.name ?? 'Gift cards'
      : 'All gift cards';

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8">
        {/* `py-2` makes each crumb a usable tap target on a phone — the text
            itself is only 19px tall, which is hard to hit. */}
        <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-x-1.5 text-[12.5px] text-[var(--muted)]">
          <Link href="/" className="-mx-1 px-1 py-2 hover:text-[var(--text)]">
            Home
          </Link>
          <span aria-hidden>/</span>
          <span className="px-1 py-2 text-[var(--text)]">{heading}</span>
        </nav>

        <div className="mx-auto max-w-2xl">
          <Suspense fallback={<div className="skeleton h-14 rounded-none" />}>
            <SearchBar size="lg" placeholder="Search by brand, category or what you want to buy…" />
          </Suspense>
          {/* Quick category tiles double as the fastest browse path. */}
          <div className="mt-3.5 flex flex-wrap justify-center gap-2">
            {categories.slice(0, 10).map((c) => (
              <Link
                key={c.id}
                href={`/products?category=${c.slug}`}
                className="badge gap-1.5 py-2.5 text-[12px] font-semibold transition-colors hover:border-[var(--accent)] sm:py-1.5"
              >
                <span aria-hidden>{c.icon ?? '🎁'}</span>
                {c.name}
                <span className="font-mono text-[11px] font-bold text-[var(--muted)]">{c.productCount}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-medium tracking-[-0.025em] sm:text-[34px]">{heading}</h1>
            <p className="mt-1.5 text-[14px] text-[var(--muted)]">
              {result.total} {result.total === 1 ? 'card' : 'cards'} available in {countryLabel(effectiveCountry)}
              {q ? <span> for “{q}”</span> : null}
            </p>
          </div>
          <Suspense fallback={<div className="skeleton h-10 w-44 rounded-none" />}>
            <SortSelect current={sort} />
          </Suspense>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <CatalogFilters categories={categories} activeCategory={category} q={q} />
          </aside>

          <div>
            {result.products.length === 0 ? (
              <div className="card p-12 text-center">
                <div className="text-[34px]" aria-hidden>
                  🔍
                </div>
                <h2 className="mt-4 text-[18px] font-bold">No gift cards match your search</h2>
                <p className="mx-auto mt-2 max-w-md text-[14px] text-[var(--muted)]">
                  Try a different brand, clear your filters, or switch your region — availability depends on where you
                  are.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                  <Link href="/products" className="btn btn-primary">
                    Clear filters
                  </Link>
                  <Link href="/faq" className="btn btn-ghost">
                    How availability works
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-4">
                  {result.products.map((p, i) => (
                    <ProductCard key={p.id} product={p} priority={i < 8} />
                  ))}
                </div>
                <p className="mt-8 text-center text-[12.5px] text-[var(--muted)]">
                  Showing {result.products.length} of {result.total} cards
                </p>
              </>
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}