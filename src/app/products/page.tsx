import Link from 'next/link';
import { Suspense } from 'react';
import { getTenant } from '@/lib/tenant';
import { brandOrDefaults } from '@/lib/tenant';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard';
import { HeroSearch } from '@/components/HeroSearch';
import { getProducts, getCategories } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const [tenant, products, categories] = await Promise.all([
    getTenant(),
    getProducts(),
    getCategories(),
  ]);
  const brand = brandOrDefaults(tenant);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="relative border-b border-[var(--grid)] py-10 sm:py-14">
          <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative container">
            <div className="mx-auto max-w-3xl text-center">
              <div className="inline-flex items-center gap-2 py-1.5 px-3 rounded-full border border-[var(--grid)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] mb-8">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                <span className="font-mono text-[11px] font-medium">All Brands</span>
              </div>
              <h1 className="t-display text-balance">All Gift Cards</h1>
              <p className="mx-auto mt-6 max-w-lg text-pretty text-[15px] leading-relaxed text-[var(--muted)] sm:text-[16px]">
                {products.length} brands available worldwide. Pay with USDC on Solana — instant delivery.
              </p>
              <div className="mt-7">
                <HeroSearch />
              </div>
            </div>
          </div>
        </section>

        <section className="container section">
          <div className="section-head flex-wrap">
            <div>
              <div className="t-label">Categories</div>
              <h2 className="t-h2 mt-2 text-balance">Browse by category</h2>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/products?category=${c.slug}`}
                className="card group flex items-center gap-2.5 px-4 py-2.5 transition-all hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]"
              >
                <span className="text-[16px]" aria-hidden>{c.icon ?? '🎁'}</span>
                <span className="text-[13.5px] font-semibold">{c.name}</span>
                <span className="font-mono text-[11px] font-bold text-[var(--muted)]">{c.productCount}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="container section">
          <div className="section-head flex-wrap">
            <div>
              <div className="t-label">All products</div>
              <h2 className="t-h2 mt-2 text-balance">All gift cards</h2>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            }
          >
            <div className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 4} />
              ))}
            </div>
          </Suspense>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}