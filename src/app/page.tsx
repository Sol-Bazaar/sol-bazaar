import { Suspense } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard';
import { HeroSearch } from '@/components/HeroSearch';
import { ArrowRight, CheckCircle2, Shield, Zap, Globe, Sparkles, CreditCard } from 'lucide-react';
import { getFeaturedProducts, getCategories } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const [products, categories] = await Promise.all([
    getFeaturedProducts(12),
    getCategories(),
  ]);

  return (
    <>
      <SiteHeader />

      <main id="main">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative border-b border-[var(--grid)] py-14 sm:py-18 lg:py-22">
          <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative container">
            <div className="mx-auto max-w-3xl text-center">
              <div className="inline-flex items-center gap-2 py-1.5 px-3 rounded-full border border-[var(--grid)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] mb-8">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                <Globe className="h-3.5 w-3.5 text-[var(--ok)]" />
                <span className="font-mono text-[11px] font-medium">180+ Countries</span>
              </div>

              <h1 className="t-display text-balance">Gift Cards on Crypto</h1>

              <p className="mx-auto mt-6 max-w-lg text-pretty text-[15px] leading-relaxed text-[var(--muted)] sm:text-[16px]">
                6,600+ brands. 180+ countries. Pay with USDC on Solana — settled on-chain in seconds, no bank account required.
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
            </div>

            {/* Trust row */}
            <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 border border-[var(--grid)] sm:grid-cols-4">
              {[
                { icon: Zap, k: 'Instant', v: 'Code by email', d: 'Seconds after payment' },
                { icon: Shield, k: 'Non-custodial', v: 'Direct pay', d: 'Your keys, your crypto' },
                { icon: CheckCircle2, k: 'On-chain', v: 'Solana', d: 'Fully verifiable' },
                { icon: Globe, k: 'Global', v: '180+', d: 'Countries served' },
              ].map((s, i) => (
                <div
                  key={s.k}
                  className={`px-4 py-4 ${i % 2 === 0 ? 'border-r border-[var(--grid)]' : ''} ${
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

        {/* Categories */}
        {categories.length ? (
          <section className="container section">
            <div className="section-head flex-wrap">
              <div>
                <div className="t-label">Categories</div>
                <h2 className="t-h2 mt-2 text-balance">What are you buying for?</h2>
              </div>
              <Link href="/products" className="t-small shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--text)]">
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
                  <span className="text-[16px]" aria-hidden>{c.icon ?? '🎁'}</span>
                  <span className="text-[13.5px] font-semibold">{c.name}</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--muted)]">{c.productCount}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Featured products */}
        <section className="container section">
          <div className="section-head flex-wrap">
            <div>
              <div className="t-label">Popular right now</div>
              <h2 className="t-h2 mt-2 text-balance">Top gift cards</h2>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-[var(--muted)]">
                Available worldwide. Pay with USDC on Solana — instant delivery.
              </p>
            </div>
            <Link href="/products?sort=popular" className="t-small shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--text)]">
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
        </section>

        {/* How it works */}
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
          <div className="relative mt-10">
            <div aria-hidden className="absolute left-0 right-0 top-7 hidden h-px lg:block" style={{
              background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 45%, transparent) 15%, color-mix(in srgb, var(--accent-2) 45%, transparent) 85%, transparent)',
            }} />
            <ol className="relative grid gap-5 lg:grid-cols-3 lg:gap-7">
              {[
                { n: '1', title: 'Pick your cards', body: 'Choose a brand and amount. We reserve the stock the moment you start checkout.', icon: 'cart' as const },
                { n: '2', title: 'Pay with USDC on Solana', body: 'Every order gets its own Solana address. The amount is locked — pay exactly that in USDC.', icon: 'wallet' as const },
                { n: '3', title: 'Get the code instantly', body: 'The moment the chain confirms, the code is issued and emailed to you.', icon: 'bolt' as const },
              ].map((s) => (
                <Step key={s.n} {...s} />
              ))}
            </ol>
          </div>

          <div className="mt-8 grid gap-3.5 sm:grid-cols-3">
            {[
              { icon: Shield, title: 'Codes encrypted at rest', body: 'AES-256-GCM encrypted with keys held outside the database. Even a full dump yields nothing redeemable.' },
              { icon: Globe, title: 'Unique address per order', body: 'HD-derived Solana address per order — payments attributed exactly, no memo matching, no guessing.' },
              { icon: Zap, title: 'Issued after chain confirms', body: 'Fulfilment blocked until payment reaches confirmation depth. Never sell against unconfirmed deposits.' },
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

        {/* Payment rail */}
        <section className="container section">
          <div className="card overflow-hidden">
            <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:items-center">
              <div>
                <span className="badge gap-1.5">
                  <Sparkles className="h-3 w-3" style={{ color: 'var(--ok)' }} />
                  USDC on Solana
                </span>
                <h2 className="mt-4 text-balance text-[26px] font-medium leading-tight tracking-[-0.02em] sm:text-[32px]">
                  Pay with USDC on Solana
                </h2>
                <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--muted)]">
                  Pick USDC at checkout and we lock the exact amount. The rate is fixed the moment you check out.
                </p>
                <ul className="mt-5 space-y-2.5 text-[13.5px]">
                  {[
                    'Fixed quote — no price slippage during payment window',
                    'Detects underpayment and shows exactly what is missing',
                    'Every order page shows the real on-chain transaction',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <CreditCard className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
                      <span className="text-[var(--muted)]">{t}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_srgb,var(--elevated)_80%,transparent)] font-mono text-[11px] font-medium text-[var(--accent)]">
                      USDC
                    </span>
                    <div>
                      <div className="text-[14px] font-bold">USD Coin (USDC)</div>
                      <div className="font-mono text-[10.5px] text-[var(--muted)]">SPL Token on Solana</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[14px] font-bold tabular-nums">$1.00</div>
                    <div className="text-[10.5px] text-[var(--muted)]">6 decimals</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 transition-transform group-open:rotate-180 text-[var(--muted)]">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--muted)]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="container section">
          <div className="rounded-none border border-[var(--line)] bg-[var(--surface)] px-7 py-14 text-center sm:px-12">
            <h2 className="t-h1 text-balance">Ready to send some gift cards?</h2>
            <p className="mx-auto mt-3 max-w-lg text-[14.5px] leading-relaxed text-[var(--muted)]">
              {products.length} brands available worldwide. Pay with USDC, get the code by email in under a minute.
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

function Step({ n, title, body, icon }: { n: string; title: string; body: string; icon: keyof typeof ICONS }) {
  return (
    <li className="card relative p-6 text-center lg:pt-7">
      <span
        className="absolute left-1/2 top-0 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-none border border-white/15 text-white shadow-lg"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
        aria-hidden
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
      </span>
      <div className="mt-6 text-[11px] font-medium tracking-[0.2em] text-[var(--muted)]">STEP {n}</div>
      <h3 className="mt-2 text-[16px] font-bold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--muted)]">{body}</p>
    </li>
  );
}

const ICONS = {
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h13" />
      <path d="M3 6v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </>
  ),
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
};

const LANDING_FAQ = [
  {
    q: 'How fast do I get my gift card code?',
    a: 'Immediately. As soon as your USDC payment confirms on Solana, we place the order and email you the redeemable code — typically under 60 seconds.',
  },
  {
    q: 'Which countries can I buy from?',
    a: '180+ countries supported. We filter the catalogue by your detected region and only show cards that can be legally redeemed where you are.',
  },
  {
    q: 'What happens if I pay the wrong amount?',
    a: 'Your order page shows exactly how much is still missing. Small shortfalls are accepted automatically; larger ones can be topped up from the same address before the order expires.',
  },
  {
    q: 'Can I get a refund?',
    a: 'Crypto payments are irreversible, so once a gift card code has been issued it cannot be refunded. If an order fails on our side before a code is issued, we refund the full amount.',
  },
  {
    q: 'Do you hold my money?',
    a: 'No. You pay a dedicated Solana address that belongs to your order alone. There is no pooled wallet and no custodial balance.',
  },
];