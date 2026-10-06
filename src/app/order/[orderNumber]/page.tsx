'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant';
import { brandOrDefaults } from '@/lib/tenant';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { formatUsd } from '@/lib/utils';
import { CheckCircle2, Loader2, CreditCard, Shield, ExternalLink, Copy, Check, ChevronRight, AlertCircle } from 'lucide-react';

interface Props {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ email?: string; code?: string }>;
}

export default async function OrderPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const { email } = await searchParams;
  const tenant = await getTenant();
  const brand = brandOrDefaults(tenant);

  // Mock order data - in production, fetch from database
  const order = {
    orderNumber,
    email: email || 'customer@example.com',
    status: 'COMPLETED' as 'COMPLETED' | 'PAID' | 'PENDING_PAYMENT' | 'EXPIRED' | 'FAILED',
    payment: {
      token: 'USDC',
      amount: '25.00',
      address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      txSignature: '5KJp9m...3n2L1q',
      confirmations: 32,
    },
    items: [
      { productName: 'Netflix', faceValue: 25, quantity: 1, unitPriceUsd: 25 },
    ],
    codes: ['NFLX-7XK9-2M4P-Q8R3'],
    createdAt: new Date(),
    completedAt: new Date(),
  };

  const isPaid = order.status === 'COMPLETED' || order.status === 'PAID';
  const cardValue = order.items.reduce((a, l) => a + l.faceValue * l.quantity, 0);
  const platformFee = (cardValue * 200) / 10_000;
  const grandTotal = cardValue + platformFee;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="container section">
          <div className="mx-auto max-w-2xl">
            {isPaid ? (
              <OrderSuccess order={order} brand={brand} />
            ) : order.status === 'EXPIRED' ? (
              <OrderExpired orderNumber={orderNumber} />
            ) : (
              <OrderPayment order={order} />
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function OrderSuccess({ order, brand }: { order: any; brand: any }) {
  return (
    <div className="card p-8 text-center" style={{ borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' }}>
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--ok) 16%, transparent)' }}>
        <CheckCircle2 className="h-8 w-8" style={{ color: 'var(--ok)' }} />
      </div>
      <h2 className="mt-5 text-[22px] font-medium tracking-[-0.02em]">Payment received</h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--muted)]">
        We&apos;ve emailed your gift card code to <strong className="text-[var(--text)]">{order.email}</strong>. It should arrive within a minute — check spam if it doesn&apos;t.
      </p>

      <div className="mt-8 border-t border-[var(--line)] pt-8">
        <h3 className="text-[15px] font-bold mb-4">Your codes</h3>
        <div className="space-y-3">
          {order.codes.map((code: string, i: number) => (
            <div key={i} className="flex items-center justify-between gap-4 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] p-4">
              <div>
                <div className="font-mono text-[13px] font-bold">{code}</div>
                <div className="text-[12px] text-[var(--muted)]">Netflix • $25.00</div>
              </div>
              <button className="btn btn-ghost btn-sm" aria-label="Copy code">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link href="/products" className="btn btn-primary">
          Buy more cards
          <ChevronRight className="h-4 w-4 ml-1" />
        </Link>
        <a href={`/order/${order.orderNumber}?email=${encodeURIComponent(order.email)}`} className="btn btn-ghost">
          View order details
        </a>
      </div>
    </div>
  );
}

function OrderExpired({ orderNumber }: { orderNumber: string }) {
  return (
    <div className="card p-8 text-center" style={{ borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' }}>
      <div className="text-[34px]" aria-hidden>⏰</div>
      <h2 className="mt-3 text-[20px] font-medium">This order expired</h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--muted)]">
        The payment window closed, so this order was released. If you already sent USDC, contact support with your order number and we will return it.
      </p>
      <Link href="/products" className="btn btn-primary mt-6">
        Start a new order
      </Link>
    </div>
  );
}

function OrderPayment({ order }: { order: any }) {
  const sendAddress = order.payment.address;
  const amount = order.payment.amount;

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="border-b border-[var(--line)] px-6 py-8 text-center">
          <div className="t-label">Send exactly</div>
          <div className="mt-2 font-mono text-[34px] font-medium leading-none tabular-nums sm:text-[42px]">
            {amount} <span className="text-[20px] sm:text-[24px]">USDC</span>
          </div>
          <p className="mt-2 text-[12px] text-[var(--muted)]">on Solana mainnet-beta</p>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] px-3 py-1.5">
            <Countdown />
            <span className="text-[12px] text-[var(--muted)]">until this order expires</span>
          </div>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr]">
          <div className="mx-auto sm:mx-0">
            <div className="rounded-none bg-white p-3" style={{ animation: 'var(--animate-pulse-ring)' }}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=336x336&margin=8&data=${encodeURIComponent(`solana:${sendAddress}?amount=${amount}&reference=${sendAddress}&label=GiftCard Store&message=Gift card purchase`)}`} alt="QR code to send USDC to your payment address" width={168} height={168} className="block mx-auto" />
            </div>
            <p className="mt-2 text-center text-[11px] text-[var(--muted)]">Scan with your wallet</p>
          </div>

          <div className="min-w-0 space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="t-label">Your USDC address on Solana</span>
                <button onClick={() => copyToClipboard(sendAddress, 'address')} className="btn btn-ghost btn-sm" aria-label="Copy payment address">Copy</button>
              </div>
              <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-[var(--muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden />
                Unique to this order · one-time use only
              </div>
              <div className="rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3">
                <code className="block break-all font-mono text-[12.5px] leading-relaxed">{sendAddress}</code>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] px-3 py-2">
                <div>
                  <div className="t-label">Amount to send</div>
                  <div className="mt-0.5 font-mono text-[15px] font-medium tabular-nums">{amount} USDC</div>
                </div>
                <button onClick={() => copyToClipboard(`${amount} USDC`, 'amount')} className="btn btn-ghost btn-sm">Copy</button>
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">Base units: <span className="font-mono">{BigInt(Math.round(parseFloat(amount) * 1_000_000)).toString()}</span></p>
            </div>

            <div className="flex gap-2.5 rounded-none border border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-3.5" role="alert">
              <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
              <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--warn)' }}>
                You are paying with <strong>USDC</strong>. Send it in your wallet&apos;s <strong>USDC</strong> token on <strong>Solana</strong>. Sending SOL to this address, or USDC on another chain, will not be detected and your funds will be lost.
              </div>
            </div>

            <ol className="space-y-2 text-[12.5px] text-[var(--muted)]">
              {[
                `Open your wallet's send screen for USDC on Solana.`,
                'Paste the address above, or scan the QR code.',
                `Send exactly ${amount} USDC — sending less means we cannot issue your card.`,
                'Come back to this page. Your card is delivered automatically once the payment confirms.',
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[10.5px] font-medium" style={{ color: 'var(--accent)' }}>{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <div className="flex items-center gap-2.5 rounded-none border border-[var(--line)] px-3.5 py-2.5">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
              </span>
              <span className="text-[12.5px] font-medium">Waiting for your payment</span>
            </div>
          </div>
        </div>
      </div>

      <SupportNote orderNumber={order.orderNumber} />
    </div>
  );
}

function Countdown() {
  const [timeLeft, setTimeLeft] = useState(30 * 60);
  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  return <span className="font-mono text-[13px] font-medium tabular-nums" style={{ color: timeLeft < 120 ? 'var(--bad)' : 'var(--text)' }}>{m}:{String(s).padStart(2, '0')}</span>;
}

function SupportNote({ orderNumber }: { orderNumber: string }) {
  return (
    <p className="text-center text-[12px] leading-relaxed text-[var(--muted)]">
      Sent the wrong amount, or nothing arrived?{' '}
      <a href={`mailto:support@giftcardstore.com?subject=${encodeURIComponent(`Order ${orderNumber}`)}`} className="underline underline-offset-2">
        Contact support
      </a>{' '}
      with order <span className="font-mono">{orderNumber}</span> — include the transaction signature and we can trace it instantly.
    </p>
  );
}

function copyToClipboard(text: string, type: string) {
  navigator.clipboard.writeText(text);
  // Could add toast notification here
}