'use client';

import Link from 'next/link';
import { useCart } from '@/components/CartProvider';
import { formatUsd } from '@/lib/utils';
import { Trash2, ChevronRight, Plus, Minus, CreditCard } from 'lucide-react';

export function CartContent() {
  const { lines, subtotalUsd, hydrated, updateQuantity, removeLine, clear } = useCart();

  if (!hydrated) return <div className="skeleton h-64 rounded-none" />;

  if (!lines.length) {
    return (
      <div className="card p-12 text-center">
        <h2 className="text-[18px] font-bold">Your cart is empty</h2>
        <p className="mt-2 text-[14px] text-[var(--muted)]">Add some gift cards to get started.</p>
        <Link href="/products" className="btn btn-primary mt-6">
          Browse gift cards
        </Link>
      </div>
    );
  }

  const platformFeeBps = 200;
  const cardValue = lines.reduce((a, l) => a + l.faceValue * l.quantity, 0);
  const platformFee = (cardValue * platformFeeBps) / 10_000;
  const grandTotal = Number(subtotalUsd) + platformFee;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {lines.map((line) => (
            <div key={`${line.productId}-${line.faceValue}`} className="card flex items-center gap-4 p-4">
              <div className="shrink-0 w-16 h-16 overflow-hidden rounded-none border border-white/10 bg-[color-mix(in_srgb,var(--elevated)_70%,transparent)]">
                {line.logoUrl ? (
                  <img src={line.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-white font-medium text-[20px]">
                    {line.productName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="truncate text-[14px] font-medium">{line.productName}</h3>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--muted)]">
                  <span>${Number(line.faceValue).toLocaleString('en-US')} × {line.quantity}</span>
                  <span className="font-mono font-bold">${(Number(line.unitPriceUsd) * line.quantity).toFixed(2)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQuantity(line.productId, line.faceValue, line.quantity - 1)}
                  disabled={line.quantity <= 1}
                  className="btn btn-ghost btn-sm h-8 w-8 !px-0"
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="font-mono text-[14px] font-bold w-10 text-center">{line.quantity}</span>
                <button
                  onClick={() => updateQuantity(line.productId, line.faceValue, line.quantity + 1)}
                  className="btn btn-ghost btn-sm h-8 w-8 !px-0"
                  aria-label="Increase quantity"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => removeLine(line.productId, line.faceValue)}
                  className="btn btn-ghost btn-sm h-8 w-8 !px-0 text-[var(--bad)] hover:border-[var(--bad)] hover:text-[var(--bad)]"
                  aria-label="Remove item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card p-4 border-t border-[var(--line)]">
          <button
            onClick={clear}
            className="btn btn-ghost btn-sm text-[var(--bad)] hover:border-[var(--bad)] hover:text-[var(--bad)]"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear cart
          </button>
        </div>
      </div>

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
            <dt className="text-[var(--muted)]">Platform fee (2%)</dt>
            <dd className="font-mono tabular-nums">${platformFee.toFixed(2)}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 text-[15px]">
            <dt className="font-bold">Total</dt>
            <dd className="font-mono font-medium tabular-nums">${grandTotal.toFixed(2)}</dd>
          </div>
        </dl>

        <div className="mt-3.5 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] p-3.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">Platform fee (2%)</span>
            <span className="font-mono tabular-nums">${platformFee.toFixed(2)}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
            A 2% fee on each card covers crypto processing and support. It is charged separately and transferred on Solana to our fee wallet.
          </p>
        </div>

        <div className="mt-4 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] p-3.5 text-[12px] leading-relaxed text-[var(--muted)]">
          You'll pay with <strong className="text-[var(--text)]">USDC on Solana</strong>. The exact amount is locked for 30 minutes.
        </div>

        <Link href="/checkout" className="btn btn-primary btn-lg mt-4 w-full">
          Proceed to checkout
          <ChevronRight className="h-4 w-4 ml-2" />
        </Link>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--muted)]">
          By continuing you agree to our{' '}
          <a href="/terms" className="underline underline-offset-2">terms</a>{' '}
          and{' '}
          <a href="/privacy" className="underline underline-offset-2">privacy policy</a>.
        </p>
      </div>
    </aside>
  </>
  );
}