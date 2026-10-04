'use client';

import Link from 'next/link';
import { useCart, lineKey } from './CartProvider';

export function CartView({ minOrderUsd, platformFeeBps = 100 }: { minOrderUsd: number; platformFeeBps?: number }) {
  const { lines, setQty, remove, clear, hydrated, subtotalUsd } = useCart();

  if (!hydrated) {
    return (
      <div className="card p-10 text-center">
        <div className="skeleton mx-auto h-6 w-40 rounded" />
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="card p-12 text-center">
        <div className="text-[42px]" aria-hidden>
          🛒
        </div>
        <h2 className="mt-4 text-[19px] font-bold">Your cart is empty</h2>
        <p className="mx-auto mt-2 max-w-sm text-[14px] text-[var(--muted)]">
          Pick a gift card and an amount to get started. New customers usually pick a 25 or 50 dollar card.
        </p>
        <Link href="/products" className="btn btn-primary mt-6">
          Browse gift cards
        </Link>
      </div>
    );
  }

  const belowMin = subtotalUsd < minOrderUsd;
  const cardValue = lines.reduce((a, l) => a + Number(l.faceValue) * l.quantity, 0);
  const platformFee = (cardValue * platformFeeBps) / 10_000;
  const grandTotal = subtotalUsd + platformFee;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {lines.map((l) => {
          const key = lineKey(l);
          return (
            <div key={key} className="card flex items-center gap-4 p-4">
              <div
                className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-none border border-white/10 text-[15px] font-medium text-white"
                style={{ background: l.accent ? `linear-gradient(140deg, ${l.accent}, var(--accent-2))` : 'var(--elevated)' }}
              >
                {l.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.logoUrl} alt="" className="h-full w-full object-contain p-1.5" />
                ) : (
                  l.productName.slice(0, 2).toUpperCase()
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[14.5px] font-bold">{l.productName}</h3>
                <p className="mt-0.5 font-mono text-[12.5px] text-[var(--muted)] tabular-nums">
                  ${Number(l.faceValue).toLocaleString('en-US')} face value
                </p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setQty(key, l.quantity - 1)}
                  className="grid h-8 w-8 place-items-center rounded-none border border-[var(--line)] text-[16px] font-bold hover:border-[var(--accent)] disabled:opacity-35"
                  disabled={l.quantity <= 1}
                  aria-label={`Decrease quantity of ${l.productName}`}
                >
                  −
                </button>
                <span className="w-8 text-center font-mono text-[14px] font-bold tabular-nums">{l.quantity}</span>
                <button
                  type="button"
                  onClick={() => setQty(key, l.quantity + 1)}
                  className="grid h-8 w-8 place-items-center rounded-none border border-[var(--line)] text-[16px] font-bold hover:border-[var(--accent)] disabled:opacity-35"
                  disabled={l.quantity >= 50}
                  aria-label={`Increase quantity of ${l.productName}`}
                >
                  +
                </button>
              </div>

              <div className="w-20 text-right font-mono text-[14px] font-bold tabular-nums">
                ${(Number(l.unitPriceUsd) * l.quantity).toFixed(2)}
              </div>

              <button
                type="button"
                onClick={() => remove(key)}
                className="grid h-8 w-8 place-items-center rounded-none text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] hover:text-[var(--bad)]"
                aria-label={`Remove ${l.productName} from cart`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}

        <div className="flex items-center justify-between pt-1">
          <Link href="/products" className="text-[13.5px] font-semibold text-[var(--muted)] hover:text-[var(--text)]">
            ← Continue shopping
          </Link>
          <button type="button" onClick={clear} className="text-[12.5px] text-[var(--muted)] hover:text-[var(--bad)]">
            Clear cart
          </button>
        </div>
      </div>

      {/* Summary */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-5">
          <h2 className="text-[15px] font-bold">Order summary</h2>

          <dl className="mt-4 space-y-2.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Card value</dt>
              <dd className="font-mono tabular-nums">${cardValue.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Processing fee</dt>
              <dd className="font-mono tabular-nums">${(subtotalUsd - cardValue).toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">
                Platform fee ({(platformFeeBps / 100).toFixed(2)}%)
              </dt>
              <dd className="font-mono tabular-nums">${platformFee.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--line)] pt-2.5 text-[15px]">
              <dt className="font-bold">Total</dt>
              <dd className="font-mono font-medium tabular-nums">${grandTotal.toFixed(2)}</dd>
            </div>
          </dl>

          {belowMin ? (
            <p className="mt-4 rounded-none px-3 py-2 text-[12.5px] font-medium" style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
              Add ${(minOrderUsd - subtotalUsd).toFixed(2)} more to reach the ${minOrderUsd.toFixed(2)} minimum.
            </p>
          ) : null}

          <Link href={belowMin ? '#' : '/checkout'} className={`btn btn-primary btn-lg mt-5 w-full ${belowMin ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={belowMin}>
            Continue to checkout
          </Link>

          <p className="mt-3.5 text-center text-[11.5px] leading-relaxed text-[var(--muted)]">
            You&apos;ll choose your crypto and get a unique payment address on the next step.
          </p>
        </div>
      </aside>
    </div>
  );
}