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
import { ArrowRight, CheckCircle2, Shield, Zap, Globe, Sparkles, ChevronDown } from 'lucide-react';

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
        <section className="relative border-b border-[var(--grid)] py-14 sm:py-18 lg:py-22">
          {/*
            Grid field behind the hero. `--cell` keeps it aligned with the card
            gutters below, so the whole page reads as one drawing rather than a
            hero sitting on top of a grid.
          */}
          <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-50" />

          <div className="relative mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              {/* Personalised for the visitor's resolved market. Rendered
                  server-side, so no flash of a generic or wrong-region hero. */}
              <div className="inline-flex items-center gap-2 py-1.5 px-3 rounded-full border border-[var(--grid)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] mb-8">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                <Globe className="h-3.5 w-3.5 text-[var(--ok)]" />
                <span className="font-mono text-[11px] font-medium">{countryName}</span>
                {solPrice ? (
                  <span className="text-[var(--faint)] font-mono text-[11px]">· SOL {formatUsd(solPrice.usd)}</span>
                ) : null}
              </div>

              <h1 className="t-display text-balance">{brand.heroHeadline}</h1>

              <p className="mx-auto mt-6 max-w-lg text-pretty text-[15px] leading-relaxed text-[var(--muted)] sm:text-[16px]">
                {brand.heroSubhead}
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/products" className="btn btn-primary btn-lg w-full sm:w-auto">
                  Browse all gift cards
                  <ArrowRight className="h-4 w-4 ml-1" />
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
                { icon: Zap, k: 'Instant', v: 'Code by email', d: 'Right after confirm' },
                { icon: Shield, k: 'Non-custodial', v: 'Direct pay', d: 'Straight to you' },
                { icon: CheckCircle2, k: 'On-chain', v: 'Solana', d: 'Fully verifiable' },
                { icon: Globe, k: 'Global', v: '190+', d: 'Countries served' },
              ].map((s, i) => (
                <div
                  key={s.k}
                  className={`px-4 py-4 flex flex-col items-center text-center ${i % 2 === 0 ? 'border-r border-[var(--grid)]' : ''} ${
                    i < 2 ? 'border-b border-[var(--grid)] sm:border-b-0' : ''
                  } ${i === 1 ? 'sm:border-r' : ''} ${i === 2 ? 'sm:border-r' : ''}`}
                >
                  <div className="flex items-center justify-center h-10 w-10 rounded-none border border-[var(--grid)] bg-[color-mix(in_srgb,var(--surface)_50%,transparent)] mb-3">
                    <s.icon className="h-5 w-5" style={{ color: 'var(--accent)' }} />
                  </div>
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
          <section className="container section">
            <div className="section-head flex-wrap">
              <div>
                <div className="t-label">Categories</div>
                <h2 className="t-h2 mt-2 text-balance">What are you buying for?</h2>
              </div>
              <Link
                href="/products"
                className="t-small shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              >
                See everything →
              </Link>
            </div>
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
        <section className="container section">
          <div className="section-head flex-wrap">
            <div>
              <div className="t-label">Popular right now</div>
              <h2 className="t-h2 mt-2 text-balance">Top gift cards</h2>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-[var(--muted)]">
                Available in {countryName}. Prices include live crypto conversion.
              </p>
            </div>
            <Link
              href="/products?sort=popular"
              className="t-small shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            >
              View all →
            </Link>
          </div>

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
        <section id="how-it-works" className="container section">
          <div className="section-head flex-wrap">
            <div>
              <div className="t-label">How it works</div>
              <h2 className="t-h2 mt-2 text-balance">Three steps. About 40 seconds.</h2>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-[var(--muted)]">
                No bank details, no card forms, no account to create. The whole flow happens on-chain.
              </p>
            </div>
          </div>
          <SolanaFlow />

          <div className="mt-8 grid gap-3.5 sm:grid-cols-3">
            {[
              {
                icon: Shield,
                title: 'Codes never touch our database in plain text',
                body: 'Redeemable codes are AES-256-GCM encrypted at rest with a key held outside the database. Even a full database dump yields nothing redeemable.',
              },
              {
                icon: Globe,
                title: 'A unique address for every order',
                body: 'Each order gets its own HD-derived Solana address, so incoming payments are attributed exactly — no memo matching, no guessing.',
              },
              {
                icon: Zap,
                title: 'Issued only after the chain confirms',
                body: 'Fulfilment is blocked until your payment reaches the required confirmation depth. We never sell a gift card against an unconfirmed deposit.',
              },
            ].map((f) => (
              <div key={f.title} className="card p-5">
                <div className="flex items-center justify-center h-10 w-10 rounded-none border border-[var(--grid)] bg-[color-mix(in_srgb,var(--surface)_50%,transparent)] mb-4">
                  <f.icon className="h-5 w-5" style={{ color: 'var(--accent)' }} />
                </div>
                <h3 className="text-[14.5px] font-bold leading-snug">{f.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Payment rail ──────────────────────────────────────────────── */}
        <section className="container section">
          <div className="card overflow-hidden">
            <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:items-center">
              <div>
                <span className="badge gap-1.5">
                  <Sparkles className="h-3 w-3" style={{ color: 'var(--ok)' }} />
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
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
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
        <section className="container section max-w-3xl">
          <div className="section-head flex-wrap">
            <div>
              <div className="t-label">Questions</div>
              <h2 className="t-h2 mt-2 text-balance">Frequently asked</h2>
            </div>
          </div>
          <div className="mt-6 space-y-2.5">
            {LANDING_FAQ.map((f) => (
              <details key={f.q} className="card group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-[14.5px] font-semibold">
                  {f.q}
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 text-[var(--muted)]" />
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
        <section className="container section">
          <div className="rounded-none border border-[var(--line)] bg-[var(--surface)] px-7 py-14 text-center sm:px-12">
            <h2 className="t-h1 text-balance">Ready to send some gift cards?</h2>
            <p className="mx-auto mt-3 max-w-lg text-[14.5px] leading-relaxed text-[var(--muted)]">
              {products.length} brands available in {countryName}. Pay with crypto, get the code by email in under a
              minute.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/products" className="btn btn-primary btn-lg">
                Shop gift cards
                <ArrowRight className="h-4 w-4 ml-1" />
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