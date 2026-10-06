import { Suspense } from 'react';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant';
import { brandOrDefaults } from '@/lib/tenant';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ProductCard } from '@/components/ProductCard';
import { CheckoutForm } from '@/components/CheckoutForm';
import { useCart } from '@/components/CartProvider';
import { getProductBySlug } from '@/lib/catalog';
import { formatUsd } from '@/lib/utils';
import { ChevronRight, CreditCard, Star, Tag, CircleDollarSign, ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const tenant = await getTenant();
  const brand = brandOrDefaults(tenant);
  const product = await getProductBySlug(slug);

  if (!product) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="text-[22px] font-medium">Product not found</h1>
          <p className="mt-2 text-[var(--muted)]">The gift card you're looking for doesn't exist.</p>
          <Link href="/products" className="btn btn-primary mt-6 inline-block">
            Browse all gift cards
          </Link>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="container section">
          <Link
            href="/products"
            className="inline-flex items-center gap-1.5 text-[13.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)] mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to all cards
          </Link>

          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <div className="aspect-square overflow-hidden rounded-none border border-[var(--grid)] bg-[color-mix(in_srgb,var(--elevated)_70%,transparent)]">
                {product.logoUrl ? (
                  <img
                    src={product.logoUrl}
                    alt={product.name}
                    className="h-full w-full object-contain p-4"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white font-bold text-[48px]">
                    {product.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="t-label">{product.category.name}</span>
                {product.brand && (
                  <span className="badge px-2 py-0.5">{product.brand.name}</span>
                )}
              </div>
              <h1 className="mt-2 t-h1">{product.name}</h1>
              {product.description && (
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{product.description}</p>
              )}
              {product.rating && (
                <div className="mt-3 flex items-center gap-2">
                  <Star className="h-4 w-4 fill-current" style={{ color: 'var(--warn)' }} />
                  <span className="font-mono text-[14px] font-bold">{product.rating.toFixed(1)}</span>
                  <span className="text-[var(--muted)]">out of 5</span>
                </div>
              )}

              <div className="mt-6">
                <h2 className="text-[15px] font-bold">Choose amount</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {product.denominations.map((d) => (
                    <button
                      key={`${d.faceValue}-${d.currency}`}
                      className="t-num border border-[var(--line)] px-4 py-2 text-[14px] tabular-nums text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                    >
                      {d.currency === 'USD' ? '$' : ''}
                      {Number(d.faceValue).toLocaleString('en-US')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-8 p-5 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)]">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_srgb,var(--elevated)_80%,transparent)] font-mono text-[11px] font-medium text-[var(--accent)]">
                    USDC
                  </span>
                  <div>
                    <div className="text-[14px] font-bold">USD Coin (USDC)</div>
                    <div className="font-mono text-[10.5px] text-[var(--muted)]">SPL Token on Solana</div>
                  </div>
                </div>
                <p className="mt-3 text-[13px] text-[var(--muted)]">
                  Pay with USDC on Solana. The exact amount is locked at checkout — no price slippage.
                </p>
              </div>

              <div className="mt-6">
                <Link href="/checkout" className="btn btn-primary btn-lg w-full">
                  Buy now
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Link>
              </div>

              <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--muted)]">
                Instant delivery via email. Non-custodial — you pay directly from your wallet.
              </p>
            </div>
          </div>
        </section>

        <section className="container section">
          <div className="section-head flex-wrap">
            <div>
              <div className="t-label">You may also like</div>
              <h2 className="t-h2 mt-2 text-balance">Similar gift cards</h2>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}