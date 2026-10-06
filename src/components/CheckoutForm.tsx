'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/components/CartProvider';
import { Loader2, ChevronRight, Shield, CreditCard, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatUsd } from '@/lib/utils';

export function CheckoutForm() {
  const { lines, subtotalUsd, hydrated } = useCart();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'payment' | 'success'>('form');

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

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const canSubmit = valid && !pending && lines.length > 0;

  const platformFeeBps = 200; // 2%
  const cardValue = lines.reduce((a, l) => a + l.faceValue * l.quantity, 0);
  const platformFee = (cardValue * platformFeeBps) / 10_000;
  const grandTotal = subtotalUsd + platformFee;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lines: lines.map((l) => ({ productId: l.productId, faceValue: l.faceValue, quantity: l.quantity })),
            email: email.trim().toLowerCase(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create order');
        setStep('payment');
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  if (step === 'payment') {
    return <PaymentView orderId={''} />;
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Delivery details</h2>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            We email your redeemable codes here. Double-check it — we cannot change it once the order is placed.
          </p>
          <div className="mt-4 space-y-3.5">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold">
                Email address
                <span className="badge text-[9.5px] font-bold" style={{ color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' }}>
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
                className={`input ${email && !valid ? 'input-error' : ''}`}
                aria-invalid={!!email && !valid}
              />
              {email && !valid ? (
                <span className="mt-1 block text-[12px] font-medium" style={{ color: 'var(--bad)' }}>
                  Enter a valid email address, e.g. you@example.com
                </span>
              ) : null}
            </label>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Payment</h2>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            You'll pay with USDC on Solana. The exact amount is locked for 30 minutes.
          </p>

          <div className="mt-4">
            <button
              type="button"
              disabled={pending}
              className="relative rounded-none border p-4 text-left transition-all"
              style={{
                borderColor: 'var(--accent)',
                background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                boxShadow: '0 0 0 1px var(--accent)',
              }}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--elevated)_50%,transparent)] text-[var(--accent)]">
                  <CreditCard className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-mono text-[14px] font-medium" style={{ color: 'var(--accent)' }}>USDC</div>
                  <div className="mt-0.5 text-[12px] font-semibold">USD Coin</div>
                  <div className="text-[11px] text-[var(--muted)]">Stable price • Solana network</div>
                </div>
              </div>
              <div className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-[var(--accent)]" />
            </button>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-[15px] font-bold">Your cards</h2>
          <ul className="mt-3.5 divide-y divide-[var(--line)]">
            {lines.map((l) => (
              <li key={`${l.productId}-${l.faceValue}`} className="flex items-center justify-between gap-4 py-2.5">
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
            Next you'll see a unique Solana address and the exact USDC amount to send. Nothing is charged until you send it.
          </div>

          {error ? (
            <p className="mt-3 rounded-none px-3 py-2 text-[12.5px] font-medium" style={{ background: 'color-mix(in srgb, var(--bad) 14%, transparent)', color: 'var(--bad)' }} role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" onClick={(e) => { e.preventDefault(); onSubmit(e); }} disabled={!canSubmit} className="btn btn-primary btn-lg mt-4 w-full">
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating order…
              </>
            ) : (
              <>
                Get payment address
                <ChevronRight className="h-4 w-4 ml-2" />
              </>
            )}
          </button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--muted)]">
            By continuing you agree to our{' '}
            <a href="/terms" className="underline underline-offset-2">terms</a>{' '}
            and{' '}
            <a href="/privacy" className="underline underline-offset-2">privacy policy</a>.
          </p>
        </div>
      </aside>
    </form>
  );
}

function PaymentView({ orderId }: { orderId: string }) {
  return (
    <div className="card p-8 text-center" style={{ borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' }}>
      <Loader2 className="mx-auto h-10 w-10 animate-spin" style={{ color: 'var(--ok)' }} />
      <h2 className="mt-5 text-[22px] font-medium tracking-[-0.02em]">Creating your order…</h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--muted)]">
        Please wait while we create your order and generate the payment address.
      </p>
    </div>
  );
}