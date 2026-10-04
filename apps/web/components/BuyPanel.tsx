'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCart, lineKey } from './CartProvider';

interface Props {
  product: {
    slug: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    accent: string | null;
    inStock: boolean;
    stock: number;
    denominations: { faceValue: string; currency: string; priceUsd: string }[];
  };
  country: string;
  countryName: string;
  acceptedTokens: string[];
  minOrderUsd: number;
  maxOrderUsd: number;
}

/**
 * Denomination picker + quantity + add-to-cart.
 *
 * Prices shown here are advisory only — `createOrder` re-prices every line from
 * the database inside the order transaction, so a stale or tampered client value
 * cannot change what the customer is charged.
 */
export function BuyPanel({
  product,
  country,
  countryName,
  acceptedTokens,
  minOrderUsd,
  maxOrderUsd,
}: Props) {
  const { add } = useCart();
  const router = useRouter();

  const denoms = useMemo(
    () =>
      [...product.denominations]
        .sort((a, b) => Number(a.faceValue) - Number(b.faceValue))
        // Hide denominations we can no longer honour in sufficient quantity.
        .filter((d) => product.inStock || product.stock >= 1),
    [product],
  );

  const [selected, setSelected] = useState(denoms[0]?.faceValue ?? '');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const denom = denoms.find((d) => d.faceValue === selected) ?? denoms[0];
  const unitPrice = denom ? Number(denom.priceUsd) : 0;
  const total = unitPrice * qty;

  const belowMin = total > 0 && total < minOrderUsd;
  const aboveMax = total > maxOrderUsd;
  const exceedsStock = product.inStock && qty > product.stock;

  const canBuy = Boolean(denom) && product.inStock && qty > 0 && !belowMin && !aboveMax && !exceedsStock;

  const onAdd = () => {
    if (!denom || !canBuy) return;
    add(
      {
        productSlug: product.slug,
        productName: product.shortName || product.name,
        logoUrl: product.logoUrl,
        faceValue: denom.faceValue,
        currency: denom.currency,
        unitPriceUsd: denom.priceUsd,
        accent: product.accent,
      },
      qty,
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 2200);
  };

  if (!denoms.length) {
    return (
      <div className="card p-6">
        <h2 className="text-[15px] font-bold">Unavailable</h2>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          No denominations of this card are currently available in {countryName}.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--line)] p-5">
        <h2 className="text-[15px] font-bold">Choose an amount</h2>
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          {denoms.map((d) => {
            const active = d.faceValue === selected;
            return (
              <button
                key={d.faceValue}
                type="button"
                onClick={() => setSelected(d.faceValue)}
                aria-pressed={active}
                className="rounded-none border px-2 py-2.5 text-center transition-all"
                style={
                  active
                    ? {
                        borderColor: 'var(--accent)',
                        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                        boxShadow: '0 0 0 1px var(--accent)',
                      }
                    : {
                        borderColor: 'var(--line)',
                        background: 'color-mix(in srgb, var(--bg) 45%, transparent)',
                      }
                }
              >
                <div className="font-mono text-[15px] font-medium tabular-nums" style={active ? { color: 'var(--accent)' } : undefined}>
                  ${Number(d.faceValue).toLocaleString('en-US')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Quantity */}
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">Quantity</span>
          <div className="flex items-center gap-1">
            <StepperBtn onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity">
              −
            </StepperBtn>
            <input
              type="number"
              min={1}
              max={50}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="input no-spinner h-10 w-16 text-center font-mono text-[14px] font-bold tabular-nums sm:h-9 sm:w-14"
              aria-label="Quantity"
            />
            <StepperBtn onClick={() => setQty((q) => Math.min(50, q + 1))} disabled={qty >= 50} aria-label="Increase quantity">
              +
            </StepperBtn>
          </div>
        </div>

        {/* Totals */}
        <div className="space-y-2 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] p-3.5">
          <Row label={`Card value × ${qty}`} value={`$${(unitPrice * qty).toFixed(2)}`} />
          <Row label="Includes processing fee" value={`$${(unitPrice * qty - Number(denom!.faceValue) * qty).toFixed(2)}`} />
          <div className="border-t border-[var(--line)] pt-2">
            <Row label="Total before crypto" value={`$${total.toFixed(2)}`} strong />
          </div>
        </div>

        {belowMin ? (
          <Notice tone="warn">Minimum order is ${minOrderUsd.toFixed(2)}. Add ${(minOrderUsd - total).toFixed(2)} more.</Notice>
        ) : null}
        {aboveMax ? (
          <Notice tone="bad">Maximum order is ${maxOrderUsd.toFixed(2)}.</Notice>
        ) : null}
        {exceedsStock ? (
          <Notice tone="bad">Only {product.stock} left in stock.</Notice>
        ) : null}
        {!product.inStock ? <Notice tone="bad">This card is out of stock right now.</Notice> : null}

        <button type="button" onClick={onAdd} disabled={!canBuy} className="btn btn-primary btn-lg w-full">
          {added ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="m5 13 4 4L19 7" />
              </svg>
              Added to cart
            </>
          ) : (
            `Add to cart · $${total.toFixed(2)}`
          )}
        </button>

        {added ? (
          <button
            type="button"
            onClick={() => router.push('/cart')}
            className="btn btn-ghost w-full"
          >
            Go to cart →
          </button>
        ) : null}

        <div className="space-y-1.5 pt-1 text-[12px] text-[var(--muted)]">
          <p className="flex items-center gap-1.5">
            <Check />
            Delivered to your email in about a minute
          </p>
          <p className="flex items-center gap-1.5">
            <Check />
            Pay with {acceptedTokens.join(' or ')} on Solana
          </p>
          <p className="flex items-center gap-1.5">
            <Check />
            Redeemable in {countryName}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`font-mono tabular-nums ${strong ? 'text-[14px] font-medium' : 'font-semibold'}`}>{value}</span>
    </div>
  );
}

function StepperBtn({
  onClick,
  disabled,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="grid h-10 w-10 place-items-center rounded-none border border-[var(--line)] text-[17px] font-bold transition-colors hover:border-[var(--accent)] disabled:opacity-35 sm:h-9 sm:w-9"
      {...rest}
    >
      {children}
    </button>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  const color = tone === 'bad' ? 'var(--bad)' : 'var(--warn)';
  return (
    <p
      className="rounded-none px-3 py-2 text-[12.5px] font-medium"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      role="alert"
    >
      {children}
    </p>
  );
}

function Check() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="3.2" strokeLinecap="round" aria-hidden className="shrink-0">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export { lineKey };