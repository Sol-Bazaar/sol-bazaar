import { Suspense } from 'react';
import Link from 'next/link';
import { getTenant, getGeo } from '@/lib/tenant';
import { brandOrDefaults } from '@solbazaar/tenant';
import { countryLabel, formatUsd } from '@solbazaar/core';
import { getFeatured, listCategories } from '@/lib/catalog';
import { getPriceBoard } from '@/lib/pricing';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard';
import { CountrySwitcher } from '@/components/CountrySwitcher';
import { HeroSearch } from '@/components/HeroSearch';
import { SolanaFlow } from '@/components/SolanaFlow';

export const dynamic = 'force-dynamic'; // geo-personalised; never prerender

export default async function LandingPage() {
  const [tenant, geo] = await Promise.all([getTenant(), getGeo()]);
  const brand = brandOrDefaults(tenant);

  const [products, categories, priceBoard] = await Promise.all([
    getFeatured(tenant.id, geo.country, tenant.markupBps, 12),
    listCategories(tenant.id, geo.country),
    getPriceBoard(),
  ]);

  const countryName = countryLabel(geo.country);
  const solPrice = priceBoard.find((p) => p.symbol === 'SOL');

  return (
    <>
      <SiteHeader />

      <main id="main">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative border-b border-[var(--grid)]">
          {/*
            Grid field behind the hero. `--cell` keeps it aligned with the card
            gutters below, so the whole page reads as one drawing rather than a
            hero sitting on top of a grid.
          */}
          <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-70" />

          <div className="relative mx-auto max-w-[1600px] px-4 pb-14 pt-16 sm:px-6 lg:px-8 lg:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              {/* Personalised for the visitor's resolved market. Rendered
                  server-side, so no flash of a generic or wrong-region hero. */}
              <span className="badge mx-auto mb-8 gap-2 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                {countryName}
                {solPrice ? <span className="text-[var(--faint)]">· SOL {formatUsd(solPrice.usd)}</span> : null}
              </span>

              <h1 className="t-display text-balance">{brand.heroHeadline}</h1>

              <p className="mx-auto mt-6 max-w-lg text-pretty text-[15px] leading-relaxed text-[var(--muted)] sm:text-[16px]">
                {brand.heroSubhead}
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/products" className="btn btn-primary btn-lg w-full sm:w-auto">
                  Browse all gift cards
                </Link>
                <Link href="#how-it-works" className="btn btn-ghost btn-lg w-full sm:w-auto">
                  How it works
                </Link>
              </div>

              <div className="mt-7">
                <HeroSearch />
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[12px] text-[var(--muted)]">
                <span>Not in {countryName}?</span>
                <Suspense fallback={null}>
                  <CountrySwitcher />
                </Suspense>
              </div>
            </div>

            {/* ── Trust row ──────────────────────────────────────────────── */}
            <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 border border-[var(--grid)] sm:grid-cols-4">
              {[
                { k: 'Instant', v: 'Code by email', d: 'Right after confirm' },
                { k: 'Non-custodial', v: 'Direct pay', d: 'Straight to us' },
                { k: 'On-chain', v: 'Solana', d: 'Fully verifiable' },
                { k: 'Global', v: '190+', d: 'Countries served' },
              ].map((s, i) => (
                <div
                  key={s.k}
                  className={`px-4 py-4 ${i % 2 === 0 ? 'border-r border-[var(--grid)]' : ''} ${
                    i < 2 ? 'border-b border-[var(--grid)] sm:border-b-0' : ''
                  } ${i === 1 ? 'sm:border-r' : ''} ${i === 2 ? 'sm:border-r' : ''}`}
                >
                  <div className="t-label">{s.k}</div>
                  <div className="mt-1.5 text-[14px] font-medium">{s.v}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--faint)]">{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Categories ─────────────────────────────────────────────────── */}
        {categories.length ? (
          <section className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
            <SectionHead
              eyebrow="Categories"
              title="What are you buying for?"
              action={{ href: '/products', label: 'See everything' }}
            />
            <div className="mt-6 flex flex-wrap gap-2.5">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/products?category=${c.slug}`}
                  className="card group flex items-center gap-2.5 px-4 py-2.5 transition-all hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]"
                >
                  <span className="text-[16px]" aria-hidden>
                    {c.icon ?? '🎁'}
                  </span>
                  <span className="text-[13.5px] font-semibold">{c.name}</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--muted)]">{c.productCount}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Featured products ──────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1600px] px-4 pt-16 sm:px-6 lg:px-8">
          <SectionHead
            eyebrow="Popular right now"
            title="Top gift cards"
            desc={`Available in ${countryName}. Prices include live crypto conversion.`}
            action={{ href: '/products?sort=popular', label: 'View all' }}
          />

          <Suspense
            fallback={
              <div className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
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

          {products.length === 0 ? (
            <div className="card mt-7 p-10 text-center">
              <p className="text-[15px] font-semibold">No gift cards available in {countryName} yet</p>
              <p className="mt-2 text-[13.5px] text-[var(--muted)]">
                We only list cards that can be legally redeemed in your region. Try switching your region above.
              </p>
            </div>
          ) : null}
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section id="how-it-works" className="mx-auto max-w-[1600px] scroll-mt-20 px-4 pt-20 sm:px-6 lg:px-8">
          <SectionHead
            eyebrow="How it works"
            title="Three steps. About 40 seconds."
            desc="No bank details, no card forms, no account to create. The whole flow happens on-chain."
          />
          <SolanaFlow />

          <div className="mt-8 grid gap-3.5 sm:grid-cols-3">
            {[
              {
                icon: '🔒',
                title: 'Codes never touch our database in plain text',
                body: 'Redeemable codes are AES-256-GCM encrypted at rest with a key held outside the database. Even a full database dump yields nothing redeemable.',
              },
              {
                icon: '🎯',
                title: 'A unique address for every order',
                body: 'Each order gets its own HD-derived Solana address, so incoming payments are attributed exactly — no memo matching, no guessing.',
              },
              {
                icon: '⚡',
                title: 'Issued only after the chain confirms',
                body: 'Fulfilment is blocked until your payment reaches the required confirmation depth. We never sell a gift card against an unconfirmed deposit.',
              },
            ].map((f) => (
              <div key={f.title} className="card p-5">
                <div className="text-[22px]" aria-hidden>
                  {f.icon}
                </div>
                <h3 className="mt-3 text-[14.5px] font-bold leading-snug">{f.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Payment rail ──────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1600px] px-4 pt-20 sm:px-6 lg:px-8">
          <div className="card overflow-hidden">
            <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:items-center">
              <div>
                <span className="badge gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden />
                  Live prices
                </span>
                <h2 className="mt-4 text-balance text-[26px] font-medium leading-tight tracking-[-0.02em] sm:text-[32px]">
                  Pay with SOL or USDC on Solana
                </h2>
                <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--muted)]">
                  Pick your token at checkout and we lock the exact amount for 30 minutes. The rate is fixed the moment
                  you check out — SOL can&apos;t move under your feet while you&apos;re sending the transaction.
                </p>
                <ul className="mt-5 space-y-2.5 text-[13.5px]">
                  {[
                    'Fixed quote for 30 minutes — no price slippage',
                    'Detects underpayment and shows exactly what is missing',
                    'Every order page shows the real on-chain transaction',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                      <span className="text-[var(--muted)]">{t}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2.5">
                {priceBoard.map((p) => (
                  <div key={p.symbol} className="flex items-center justify-between rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_srgb,var(--elevated)_80%,transparent)] font-mono text-[11px] font-medium">
                        {p.symbol.slice(0, 2)}
                      </span>
                      <div>
                        <div className="text-[14px] font-bold">{p.symbol}</div>
                        <div className="font-mono text-[10.5px] text-[var(--muted)]">
                          {p.mint ? `${p.mint.slice(0, 6)}…${p.mint.slice(-4)}` : 'Native SOL'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[14px] font-bold tabular-nums">${p.usd}</div>
                      <div className="text-[10.5px] text-[var(--muted)]">{p.decimals} decimals</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-4 pt-20 sm:px-6 lg:px-8">
          <SectionHead eyebrow="Questions" title="Frequently asked" />
          <div className="mt-6 space-y-2.5">
            {LANDING_FAQ.map((f) => (
              <details key={f.q} className="card group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-[14.5px] font-semibold">
                  {f.q}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 transition-transform group-open:rotate-45" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--muted)]">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-center text-[13.5px] text-[var(--muted)]">
            More answers on the{' '}
            <Link href="/faq" className="font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
              FAQ page
            </Link>
          </p>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────── */}
        {/*
          A bordered panel rather than a gradient slab. The gradient was the
          loudest element on a page that is supposed to be about the products,
          and with a white accent it rendered as a white box with white text.
        */}
        <section className="mx-auto max-w-[1600px] px-4 pt-20 sm:px-6 lg:px-8">
          <div className="rounded-none border border-[var(--line)] bg-[var(--surface)] px-7 py-14 text-center sm:px-12">
            <h2 className="t-h1 text-balance">Ready to send some gift cards?</h2>
            <p className="mx-auto mt-3 max-w-lg text-[14.5px] leading-relaxed text-[var(--muted)]">
              {products.length} brands available in {countryName}. Pay with crypto, get the code by email in under a
              minute.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/products" className="btn btn-primary btn-lg">
                Shop gift cards
              </Link>
              <Link href="#how-it-works" className="btn btn-ghost btn-lg">
                How it works
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

function SectionHead({
  eyebrow,
  title,
  desc,
  action,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  action?: { href: string; label: string };
}) {
  /*
   * Eyebrow stays muted rather than accented. With the chrome colourless, an
   * accented eyebrow would be the only thing competing with the product grid for
   * attention on a page whose entire job is showing products.
   */
  return (
    <div className="section-head flex-wrap">
      <div>
        <div className="t-label">{eyebrow}</div>
        <h2 className="t-h2 mt-2 text-balance">{title}</h2>
        {desc ? <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-[var(--muted)]">{desc}</p> : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="t-small shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          {action.label} →
        </Link>
      ) : null}
    </div>
  );
}

const LANDING_FAQ = [
  {
    q: 'How fast do I get my gift card code?',
    a: 'Immediately. As soon as your Solana payment reaches the required confirmation depth we place the order with the issuer and email you the redeemable code — typically under 60 seconds.',
  },
  {
    q: 'Which countries can I buy from?',
    a: 'It depends on the brand. We filter the catalogue by your detected region and only show cards that can be legally redeemed where you are. Use the region switcher in the header if the detection was wrong.',
  },
  {
    q: 'What happens if I pay the wrong amount?',
    a: 'Your order page shows exactly how much is still missing or how much was overpaid. Small shortfalls (under 1.5%) are accepted automatically; larger ones can be topped up from the same address before the order expires.',
  },
  {
    q: 'Can I get a refund?',
    a: 'Crypto payments are irreversible, so once a gift card code has been issued it cannot be refunded — the value is already in your hands. If an order fails on our side before a code is issued, we refund the full amount. See the refunds page.',
  },
  {
    q: 'Do you hold my money?',
    a: 'No. You pay a dedicated Solana address that belongs to your order alone, and we only move it to the issuer once your card is issued. There is no pooled wallet and no custodial balance.',
  },
];