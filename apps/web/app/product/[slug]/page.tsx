import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { getTenant, getGeo } from '@/lib/tenant';
import { countryLabel } from '@solbazaar/core';
import { getProduct } from '@/lib/catalog';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ProductCard } from '@/components/ProductCard';
import { BuyPanel } from '@/components/BuyPanel';
import { listProducts } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const [tenant, geo] = await Promise.all([getTenant(), getGeo()]);
  const product = await getProduct({ tenantId: tenant.id, slug, country: geo.country, markupBps: tenant.markupBps });
  if (!product) return { title: 'Gift card not found' };
  return {
    title: `${product.shortName || product.name} gift card`,
    description: product.description.slice(0, 160),
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const [tenant, geo] = await Promise.all([getTenant(), getGeo()]);

  const product = await getProduct({ tenantId: tenant.id, slug, country: geo.country, markupBps: tenant.markupBps });
  if (!product) notFound();

  // Same-category alternatives, geo-filtered the same way.
  const related = await listProducts({
    tenantId: tenant.id,
    country: geo.country,
    markupBps: tenant.markupBps,
    query: { category: product.category.slug, limit: 9 },
  });

  const suggestions = related.products.filter((p) => p.id !== product.id).slice(0, 5);
  const markupPct = ((tenant.markupBps / 10000) * 100).toFixed(1).replace(/\.0$/, '');

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-[1600px] px-4 py-9 sm:px-6 lg:px-8">
        {/*
          The links get vertical padding so each crumb is a ~32px tap target on a
          phone. Inline text alone was 19px tall, which is hard to hit and fails
          the 44px guideline outright. Horizontal padding keeps the slashes from
          looking crowded against the words.
        */}
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-[var(--muted)]">
          <Link href="/" className="-mx-1 px-1 py-2 hover:text-[var(--text)]">
            Home
          </Link>
          <span aria-hidden>/</span>
          <Link
            href={`/products?category=${product.category.slug}`}
            className="-mx-1 px-1 py-2 hover:text-[var(--text)]"
          >
            {product.category.name}
          </Link>
          <span aria-hidden>/</span>
          <span className="px-1 py-2 text-[var(--text)]">{product.shortName || product.name}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:gap-12">
          {/* ── Left: brand + info ──────────────────────────────────────── */}
          <div>
            <div className="flex items-start gap-5">
              <div
                className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-none border border-white/10 text-[26px] font-medium text-white"
                style={{ background: 'linear-gradient(140deg, var(--accent), var(--accent-2))' }}
              >
                {product.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.logoUrl} alt="" className="h-full w-full object-contain p-2" />
                ) : (
                  (product.shortName || product.name).slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <h1 className="text-balance text-[26px] font-medium leading-tight tracking-[-0.025em] sm:text-[32px]">
                  {product.name} Gift Card
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {product.brand ? <span className="badge">{product.brand.name}</span> : null}
                  <span className="badge">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden />
                    {product.inStock ? 'In stock' : 'Out of stock'}
                  </span>
                  <span className="badge">Instant delivery</span>
                  {product.rating ? (
                    <span className="badge">
                      <span aria-hidden>★</span> {product.rating.toFixed(1)}
                      {product.reviewCount ? <span className="text-[var(--muted)]">({product.reviewCount})</span> : null}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <p className="mt-6 text-[15px] leading-relaxed text-[var(--muted)]">{product.description}</p>

            {/* Denomination table (server-rendered so it works without JS). */}
            <div className="mt-8">
              <h2 className="text-[15px] font-bold">Available amounts</h2>
              <div className="mt-3 overflow-hidden rounded-none border border-[var(--line)]">
                <table className="w-full text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--elevated)_55%,transparent)] text-[11.5px] uppercase tracking-wider text-[var(--muted)]">
                      <th scope="col" className="px-4 py-2.5 font-bold">
                        Face value
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-bold">
                        You pay
                      </th>
                      <th scope="col" className="hidden px-4 py-2.5 font-bold sm:table-cell">
                        Fee
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.denominations.map((d) => {
                      const fee = Number(d.priceUsd) - Number(d.faceValue);
                      return (
                        <tr key={d.faceValue} className="border-b border-[var(--line)] last:border-0">
                          <td className="px-4 py-3 font-mono font-bold tabular-nums">
                            {d.currency === 'USD' ? '$' : ''}
                            {Number(d.faceValue).toLocaleString('en-US')}.00
                          </td>
                          <td className="px-4 py-3 font-mono font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
                            ${Number(d.priceUsd).toFixed(2)}
                          </td>
                          <td className="hidden px-4 py-3 font-mono text-[12.5px] tabular-nums text-[var(--muted)] sm:table-cell">
                            ${fee.toFixed(2)}
                            {markupPct !== '0' ? (
                              <span className="ml-1.5 text-[11px]">({markupPct}%)</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2.5 text-[12px] text-[var(--muted)]">
                Prices include our {markupPct}% processing fee. The crypto amount is locked for 30 minutes at checkout.
              </p>
            </div>

            {/* Details */}
            <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
              <InfoBlock
                title="How to redeem"
                body={`Go to the brand's website or app, choose “Redeem code”, and enter the code you receive by email.`}
              />
              <InfoBlock
                title="Availability"
                body={`This card can be redeemed in ${countryLabel(geo.country)} and any other region where the brand sells it.`}
              />
              <InfoBlock title="Expiry" body="Most gift cards never expire. If this brand sets an expiry, it is shown with the code." />
              <InfoBlock title="Refunds" body="Codes are non-refundable once issued. We refund automatically if we fail to deliver." />
            </div>
          </div>

          {/* ── Right: buy panel ────────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Suspense fallback={<div className="skeleton h-96 rounded-none" />}>
              <BuyPanel
                product={{
                  slug: product.slug,
                  name: product.name,
                  shortName: product.shortName,
                  logoUrl: product.logoUrl,
                  accent: product.accent,
                  inStock: product.inStock,
                  stock: product.stock,
                  denominations: product.denominations.map((d) => ({
                    faceValue: d.faceValue,
                    currency: d.currency,
                    priceUsd: d.priceUsd,
                  })),
                }}
                country={geo.country}
                countryName={countryLabel(geo.country)}
                acceptedTokens={tenant.acceptedTokens}
                minOrderUsd={Number(tenant.minOrderUsd)}
                maxOrderUsd={Number(tenant.maxOrderUsd)}
              />
            </Suspense>
          </aside>
        </div>

        {suggestions.length ? (
          <section className="mt-20">
            <h2 className="text-[20px] font-medium tracking-[-0.02em]">More in {product.category.name}</h2>
            <div className="mt-5 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
              {suggestions.map((p) => (
                <ProductCard key={p.id} product={p} compact />
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <SiteFooter />
    </>
  );
}

function InfoBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-4">
      <h3 className="text-[13px] font-bold">{title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{body}</p>
    </div>
  );
}