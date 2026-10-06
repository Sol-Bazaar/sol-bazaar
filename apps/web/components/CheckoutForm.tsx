'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from './CartProvider';
import { useWallet } from './WalletProvider';
import { BalanceCheck } from './BalanceCheck';
import { submitCheckout } from '@/app/checkout/actions';
import type { TokenSymbol } from '@solbazaar/db';

const TOKENS: { symbol: TokenSymbol; name: string; hint: string }[] = [
  { symbol: 'SOL', name: 'Solana', hint: 'Fastest and cheapest' },
  { symbol: 'USDC', name: 'USD Coin', hint: 'Stable price' },
];

export function CheckoutForm({
  acceptedTokens,
  minOrderUsd,
  maxOrderUsd,
  orderTtlMinutes,
  platformFeeBps = 100,
  collectorWallet,
  priceBoard = [],
}: {
  acceptedTokens: string[];
  minOrderUsd: number;
  maxOrderUsd: number;
  orderTtlMinutes: number;
  platformFeeBps?: number;
  collectorWallet?: string;
  /** Server-fetched price board, so the balance hint matches our own pricing. */
  priceBoard?: { symbol: TokenSymbol; usd: string; mint: string | null; decimals: number }[];
  defaultEmail: string;
}) {
  const { lines, subtotalUsd, hydrated } = useCart();
  const { session } = useWallet();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [token, setToken] = useState<TokenSymbol>((acceptedTokens[0] as TokenSymbol) ?? 'SOL');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tokenOptions = TOKENS.filter((t) => acceptedTokens.includes(t.symbol));

  /** USD price of the selected token, from the server's price board. */
  const indicativeUsdPerToken = Number(priceBoard.find((p) => p.symbol === token)?.usd ?? 0) || 1;
  const mintFor = (sym: TokenSymbol) => priceBoard.find((p) => p.symbol === sym)?.mint ?? null;

  if (!hydrated) return <div className="skeleton h-96 rounded-none" />;

  if (!lines.length) {
    return (
      <div className="card p-12 text-center">
        <h2 className="text-[18px] font-bold">Nothing to check out</h2>
        <p className="mt-2 text-[14px] text-[var(--muted)]">Add a gift card to your cart first.</p>
        <button type="button" onClick={() => router.push('/products')} className="btn btn-primary mt-6">
          Browse gift cards
        </button>
      </div>
    );
  }

  const belowMin = subtotalUsd < minOrderUsd;
  const aboveMax = subtotalUsd > maxOrderUsd;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const canSubmit = valid && !belowMin && !aboveMax && !pending && lines.length > 0;

  // Platform fee is 1% of the card value (face), charged on top of the
  // merchant markup. Displayed explicitly — burying it would be both a legal
  // and a trust problem.
  const feeBps = platformFeeBps;
  const cardValue = lines.reduce((a, l) => a + Number(l.faceValue) * l.quantity, 0);
  const platformFee = (cardValue * feeBps) / 10_000;
  const grandTotal = subtotalUsd + platformFee;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      // Fingerprint the cart so a retry maps to the same order.
      const fingerprint = btoa(
        JSON.stringify({
          l: lines.map((l) => [l.productSlug, l.faceValue, l.quantity]),
          e: email.toLowerCase(),
        }),
      ).slice(0, 120);

      const res = await submitCheckout({
        lines: lines.map((l) => ({ productSlug: l.productSlug, denomination: l.faceValue, quantity: l.quantity })),
        email: email.trim().toLowerCase(),
        fullName: fullName.trim() || undefined,
        token,
        cartFingerprint: fingerprint,
        walletAddress: session?.address ?? null,
      });

      if (!res.ok) setError(res.error ?? 'Could not start your order.');
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        {/* Contact */}
        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Delivery details</h2>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            We email your redeemable codes here. Double-check it — we cannot change it once the order is placed.
          </p>

          <div className="mt-4 space-y-3.5">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold">
                Email address
                <span
                  className="badge text-[9.5px] font-bold"
                  style={{ color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' }}
                >
                  Required
                </span>
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="input"
                aria-invalid={!!email && !valid}
                aria-describedby="email-hint"
              />
              <p id="email-hint" className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
                We send your redeemable codes here and show them on the order page. We cannot change it once the
                order is placed, so double-check it.
              </p>
              {email && !valid ? (
                <span className="mt-1 block text-[12px] font-medium" style={{ color: 'var(--bad)' }}>
                  Enter a valid email address, e.g. you@example.com
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold">
                Full name <span className="font-normal text-[var(--muted)]">(optional)</span>
              </span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Alex Morgan"
                autoComplete="name"
                maxLength={120}
                className="input"
              />
            </label>
          </div>
        </section>

        {/* Wallet balance pre-check. Advisory only — see BalanceCheck. */}
        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Wallet</h2>
          <div className="mt-3.5">
            <BalanceCheck
              tokens={{
                accepted: tokenOptions.map((t) => t.symbol),
                totalsByToken: {
                  [token]: {
                    // Indicative, computed from the live price board. The server
                    // recomputes and locks the real amount at order creation.
                    amount: (grandTotal / Math.max(1, indicativeUsdPerToken)).toFixed(9),
                    symbol: token,
                    mint: mintFor(token),
                    decimals: token === 'SOL' ? 9 : 6,
                  },
                },
              }}
            />
          </div>
          {session ? (
            <p className="mt-2.5 text-[11px] leading-relaxed text-[color-mix(in_srgb,var(--muted)_80%,transparent)]">
              Connecting is optional. It lets us show your balance and keep your orders together — payment
              always happens from the address we give you at the next step.
            </p>
          ) : null}
        </section>

        {/* Payment method */}
        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Pay with</h2>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            You&apos;ll get a dedicated Solana address to send to. The crypto amount is locked for {orderTtlMinutes} minutes.
          </p>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {tokenOptions.map((t) => {
              const active = t.symbol === token;
              return (
                <button
                  key={t.symbol}
                  type="button"
                  onClick={() => setToken(t.symbol)}
                  aria-pressed={active}
                  className="rounded-none border p-3 text-left transition-all"
                  style={
                    active
                      ? { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', boxShadow: '0 0 0 1px var(--accent)' }
                      : { borderColor: 'var(--line)', background: 'color-mix(in srgb, var(--bg) 45%, transparent)' }
                  }
                >
                  <div className="font-mono text-[13px] font-medium" style={active ? { color: 'var(--accent)' } : undefined}>
                    {t.symbol}
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold">{t.name}</div>
                  <div className="text-[11px] text-[var(--muted)]">{t.hint}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Summary of lines */}
        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Your cards</h2>
          <ul className="mt-3.5 divide-y divide-[var(--line)]">
            {lines.map((l) => (
              <li key={`${l.productSlug}-${l.faceValue}`} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">{l.productName}</div>
                  <div className="font-mono text-[11.5px] text-[var(--muted)]">
                    ${Number(l.faceValue).toLocaleString('en-US')} × {l.quantity}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-[13.5px] font-bold tabular-nums">
                  ${(Number(l.unitPriceUsd) * l.quantity).toFixed(2)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Sticky summary */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-5">
          <h2 className="text-[15px] font-bold">Summary</h2>
          <dl className="mt-4 space-y-2.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Items</dt>
              <dd className="font-mono tabular-nums">{lines.reduce((a, l) => a + l.quantity, 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Card value</dt>
              <dd className="font-mono tabular-nums">${cardValue.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Processing fee</dt>
              <dd className="font-mono tabular-nums">
                ${(subtotalUsd - cardValue + platformFee).toFixed(2)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 text-[15px]">
              <dt className="font-bold">Total</dt>
              <dd className="font-mono font-medium tabular-nums">${grandTotal.toFixed(2)}</dd>
            </div>
          </dl>

          {/* Fee disclosure — stated plainly, with where the money goes. */}
          <div className="mt-3.5 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] p-3.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-semibold">Platform fee ({(feeBps / 100).toFixed(2)}%)</span>
              <span className="font-mono tabular-nums">${platformFee.toFixed(2)}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
              A {feeBps / 100}% fee on each card covers crypto processing, issuer costs and support. It is charged
              separately and, where you pay in SOL or USDC, is transferred on Solana to{' '}
              {collectorWallet ? (
                <code className="font-mono text-[10.5px] text-[var(--text)]">
                  {collectorWallet.slice(0, 6)}…{collectorWallet.slice(-6)}
                </code>
              ) : (
                'our fee wallet'
              )}
              .
            </p>
          </div>

          <div className="mt-4 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] p-3.5 text-[12px] leading-relaxed text-[var(--muted)]">
            Next you&apos;ll see a unique Solana address and the exact amount to send in <strong className="text-[var(--text)]">{token}</strong>.
            Nothing is charged until you send it.
          </div>

          {belowMin ? (
            <p className="mt-3 rounded-none px-3 py-2 text-[12.5px] font-medium" style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
              Add ${(minOrderUsd - subtotalUsd).toFixed(2)} more to reach the minimum.
            </p>
          ) : null}
          {aboveMax ? (
            <p className="mt-3 rounded-none px-3 py-2 text-[12.5px] font-medium" style={{ background: 'color-mix(in srgb, var(--bad) 14%, transparent)', color: 'var(--bad)' }}>
              Maximum order is ${maxOrderUsd.toFixed(2)}.
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-none px-3 py-2 text-[12.5px] font-medium" style={{ background: 'color-mix(in srgb, var(--bad) 14%, transparent)', color: 'var(--bad)' }} role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={!canSubmit} className="btn btn-primary btn-lg mt-4 w-full">
            {pending ? 'Creating your order…' : 'Get payment address'}
          </button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--muted)]">
            By continuing you agree to our{' '}
            <a href="/terms" className="underline underline-offset-2">
              terms
            </a>{' '}
            and{' '}
            <a href="/privacy" className="underline underline-offset-2">
              privacy policy
            </a>
            .
          </p>
        </div>
      </aside>
    </form>
  );
}