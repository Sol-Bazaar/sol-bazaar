'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCopyToClipboard } from './OrderLookupGate';

interface Props {
  orderNumber: string;
  status: string;
  fulfillmentStatus: string;
  payment: {
    token: 'SOL' | 'USDC' | 'USDT';
    tokenName: string;
    mint: string | null;
    decimals: number;
    amountCrypto: string;
    requiredAtomic: string;
    receivedAtomic: string;
    remainingAtomic: string;
    depositAddress: string;
    ata: string | null;
    expiresAt: string;
    confirmations: number;
    toleranceBps: number;
    shortByUsd: string | null;
  };
  transactions: { signature: string; amountAtomic: string; confirmations: number; slot: number }[];
  explorerBase: string;
  isDevnet: boolean;
  email: string;
  /**
   * Local-currency view of the order total, resolved server-side.
   *
   * Presentational only. The crypto amount is derived from the USD total and is
   * what the customer must actually send; these strings exist so the number they
   * recognise is on screen next to it, with the rate stated.
   */
  display?: {
    currency: string;
    usdTotal: string;
    localTotal: string | null;
    /** e.g. "121.04 USD" — phrased for the disclosure sentence. */
    rateText: string;
  };
}

/**
 * Live payment panel.
 *
 * Polls `GET /api/v1/orders/:id/status` (a narrow, public-but-token-guarded
 * endpoint) until the payment is detected, then reloads to pick up the codes.
 *
 * For SPL tokens the address to send to is the **Associated Token Account**, not
 * the owner address — sending USDC to the owner address itself would not
 * deliver anything. This is the single most common way a customer loses money,
 * so it is displayed explicitly rather than hidden behind a toggle.
 */
export function PaymentPanel({ orderNumber, status, payment, transactions, explorerBase, isDevnet, email, display }: Props) {
  const router = useRouter();
  const { copied, copy } = useCopyToClipboard();

  const [remaining, setRemaining] = useState(calcRemaining(payment.receivedAtomic, payment.requiredAtomic));
  const [expiresIn, setExpiresIn] = useState(() => new Date(payment.expiresAt).getTime() - Date.now());
  const [pollError, setPollError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const isSettled = status === 'COMPLETED' || status === 'PAID' || status === 'FULFILLING';
  const expired = expiresIn <= 0 && !isSettled;

  // The address the customer must actually send to.
  const sendAddress = payment.token === 'SOL' ? payment.depositAddress : (payment.ata ?? payment.depositAddress);

  // ── Countdown ────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setExpiresIn(new Date(payment.expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [payment.expiresAt]);

  // ── Payment watcher ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isSettled || expired) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        setChecking(true);
        const qs = new URLSearchParams({ email });
        const res = await fetch(`/api/order/${orderNumber}/status?${qs}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });

        if (!res.ok) {
          // 401/403 means the email proof is wrong — stop hammering.
          if (res.status === 401 || res.status === 403 || res.status === 404) {
            setPollError('We could not verify this order. Check the email link and try again.');
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const body = await res.json();
        const p = body?.data?.payment;
        if (!alive || !p) throw new Error('malformed response');

        setPollError(null);
        setRemaining(BigInt(p.requiredAtomic) - BigInt(p.receivedAtomic) > 0n ? p.remainingAtomic : '0');

        if (p.status === 'COMPLETED' || p.status === 'FULFILLING') {
          router.refresh();
          return;
        }
        if (p.status === 'EXPIRED' || p.status === 'FAILED') {
          router.refresh();
          return;
        }
      } catch {
        if (alive) setPollError('Connection hiccup — still checking your payment…');
      } finally {
        if (alive) {
          setChecking(false);
          // 6s cadence is well inside the Solana ~400ms block time while
          // staying far below any sensible rate limit.
          timer = setTimeout(poll, 6000);
        }
      }
    };

    const kick = setTimeout(poll, 1500);
    return () => {
      alive = false;
      clearTimeout(kick);
      clearTimeout(timer);
    };
  }, [orderNumber, email, isSettled, expired, router]);

  const qr = useMemo(() => buildSolanaUri(sendAddress, payment), [sendAddress, payment]);

  const expired_ = expired;

  return (
    <div className="space-y-4">
      {isSettled ? (
        <SuccessBanner orderNumber={orderNumber} email={email} />
      ) : expired_ ? (
        <ExpiredBanner />
      ) : (
        <div className="card overflow-hidden">
          {/* Amount to send — the single most important number on this page. */}
          <div className="border-b border-[var(--line)] px-6 py-8 text-center">
            <div className="t-label">Send exactly</div>
            <div className="mt-2 font-mono text-[34px] font-medium leading-none tabular-nums sm:text-[42px]">
              {formatAtomic(remaining, payment.decimals)} <span className="text-[20px] sm:text-[24px]">{payment.token}</span>
            </div>
            {payment.token !== 'SOL' ? (
              <p className="mt-2 text-[12px] text-[var(--muted)]">on Solana · {isDevnet ? 'devnet' : 'mainnet-beta'}</p>
            ) : null}

            {/*
             * Rate disclosure.
             *
             * The customer thinks in their own currency, so show that figure —
             * but never without the rate behind it. An unlabelled converted
             * number reads as a hidden FX fee, and the gap between the crypto
             * amount and what they recognise is exactly where distrust starts.
             * The crypto amount above remains what they actually pay.
             */}
            {display && display.currency !== 'USD' && display.localTotal ? (
              <p className="mx-auto mt-3 max-w-sm text-[11.5px] leading-relaxed text-[var(--muted)]">
                ≈ <span className="font-medium text-[var(--text)]">{display.localTotal}</span> · converted from $
                {display.usdTotal} at 1 {payment.token} ≈ {display.rateText}
              </p>
            ) : display?.usdTotal ? (
              <p className="mt-3 text-[11.5px] text-[var(--muted)]">≈ ${display.usdTotal}</p>
            ) : null}

            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] px-3 py-1.5">
              <Countdown ms={expiresIn} />
              <span className="text-[12px] text-[var(--muted)]">until this order expires</span>
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr]">
            {/* QR */}
            <div className="mx-auto sm:mx-0">
              <div className="rounded-none bg-white p-3" style={{ animation: 'var(--animate-pulse-ring)' }}>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`QR code to send ${payment.token} to your payment address`} width={168} height={168} className="block" />
                ) : (
                  <div className="grid h-[168px] w-[168px] place-items-center text-[11px] text-black/50">QR unavailable</div>
                )}
              </div>
              <p className="mt-2 text-center text-[11px] text-[var(--muted)]">Scan with your wallet</p>
            </div>

            {/* Address + guidance */}
            <div className="min-w-0 space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="t-label">
                    {/*
                     * Name the chain, not just the token. USDC exists on six
                     * chains, and sending the right token to the right address on
                     * the wrong one is the most expensive mistake a customer can
                     * make here. This heading is the last thing they read before
                     * sending, so it carries the chain.
                     */}
                    {payment.token === 'SOL' ? 'Your Solana address' : `${payment.token} address on Solana`}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(sendAddress, 'address')}
                    className="btn btn-ghost btn-sm"
                    aria-label="Copy payment address"
                  >
                    {copied === 'address' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>

                {/* One address, one order. Stating it prevents the support
                    tickets that come from customers assuming it is reusable. */}
                <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-[var(--muted)]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                    <rect x="4" y="10" width="16" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  Unique to this order · one-time use only
                </div>

                <div className="rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3">
                  <code className="block break-all font-mono text-[12.5px] leading-relaxed">{sendAddress}</code>
                </div>

                {/* The amount gets its own copy button. Transcribing a long
                    decimal by hand from a phone is where mistakes come from, and
                    an underpayment is a failed order. */}
                <div className="mt-2.5 flex items-center justify-between gap-2 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] px-3 py-2">
                  <div>
                    <div className="t-label">Amount to send</div>
                    <div className="mt-0.5 font-mono text-[15px] font-medium tabular-nums">
                      {formatAtomic(remaining, payment.decimals)} {payment.token}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copy(`${formatAtomic(remaining, payment.decimals)} ${payment.token}`, 'amount')}
                    className="btn btn-ghost btn-sm"
                    aria-label="Copy payment amount"
                  >
                    {copied === 'amount' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  Base units: <span className="font-mono">{remaining}</span>
                </p>
              </div>

              {payment.token !== 'SOL' ? (
                <Warn>
                  You are paying with {payment.token}. Send it in your wallet&apos;s <strong>{payment.token}</strong> token
                  on <strong>Solana</strong>. Sending SOL to this address, or {payment.token} on another chain, will not
                  be detected and your funds will be lost.
                </Warn>
              ) : null}

              {payment.token !== 'SOL' && payment.ata && sendAddress !== payment.depositAddress ? (
                <div className="rounded-none border border-[var(--line)] p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Owner address (do not use for {payment.token})</div>
                  <code className="mt-1 block break-all font-mono text-[11.5px] text-[var(--muted)]">{payment.depositAddress}</code>
                </div>
              ) : null}

              <ol className="space-y-2 text-[12.5px] text-[var(--muted)]">
                {[
                  `Open your wallet's send screen for ${payment.token} on Solana.`,
                  'Paste the address above, or scan the QR code.',
                  `Send exactly ${formatAtomic(remaining, payment.decimals)} ${payment.token} — sending less means we cannot issue your card.`,
                  'Come back to this page. Your card is delivered automatically once the payment confirms.',
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[10.5px] font-medium" style={{ color: 'var(--accent)' }}>
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              {/* Live status */}
              <div className="flex items-center gap-2.5 rounded-none border border-[var(--line)] px-3.5 py-2.5">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
                </span>
                <span className="text-[12.5px] font-medium">
                  {checking ? 'Watching the chain for your payment…' : 'Waiting for your payment'}
                </span>
                <a
                  href={`/api/order/${orderNumber}/status?email=${encodeURIComponent(email)}`}
                  className="ml-auto text-[11.5px] text-[var(--muted)] underline underline-offset-2"
                >
                  JSON
                </a>
              </div>

              {pollError ? (
                <p className="text-[12px]" style={{ color: 'var(--warn)' }} role="status">
                  {pollError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Detected transactions */}
      {transactions.length ? (
        <div className="card p-5">
          <h2 className="text-[14px] font-bold">Payments detected</h2>
          <ul className="mt-3 space-y-2">
            {transactions.map((t) => (
              <li key={t.signature} className="flex items-center justify-between gap-3 rounded-none border border-[var(--line)] px-3 py-2">
                <div className="min-w-0">
                  <code className="block truncate font-mono text-[11.5px]">{t.signature}</code>
                  <div className="text-[11px] text-[var(--muted)]">
                    slot {t.slot} · {t.confirmations} confirmation{t.confirmations === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[12.5px] font-bold tabular-nums">
                    {formatAtomic(BigInt(t.amountAtomic), payment.decimals)} {payment.token}
                  </span>
                  <a
                    href={`${explorerBase.replace('SIGNATURE_PLACEHOLDER', t.signature)}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-[11.5px] text-[var(--muted)] underline underline-offset-2"
                  >
                    View
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SupportNote orderNumber={orderNumber} />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SuccessBanner({ orderNumber, email }: { orderNumber: string; email: string }) {
  return (
    <div className="card p-8 text-center" style={{ borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' }}>
      <span
        className="mx-auto grid h-16 w-16 place-items-center rounded-full"
        style={{ background: 'color-mix(in srgb, var(--ok) 16%, transparent)' }}
        aria-hidden
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
      <h2 className="mt-5 text-[22px] font-medium tracking-[-0.02em]">Payment received</h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--muted)]">
        We&apos;ve emailed your gift card code to <strong className="text-[var(--text)]">{email}</strong>. It should arrive
        within a minute — check spam if it doesn&apos;t.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <a href={`/order/${orderNumber}/codes?email=${encodeURIComponent(email)}`} className="btn btn-primary">
          View my codes
        </a>
        <a href="/products" className="btn btn-ghost">
          Buy more cards
        </a>
      </div>
    </div>
  );
}

function ExpiredBanner() {
  return (
    <div className="card p-8 text-center" style={{ borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' }}>
      <div className="text-[34px]" aria-hidden>
        ⏰
      </div>
      <h2 className="mt-3 text-[20px] font-medium">This order expired</h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--muted)]">
        The payment window closed, so this order was released. If you already sent crypto, contact support with your order
        number and we will return it.
      </p>
      <a href="/products" className="btn btn-primary mt-6">
        Start a new order
      </a>
    </div>
  );
}

function SupportNote({ orderNumber }: { orderNumber: string }) {
  return (
    <p className="text-center text-[12px] leading-relaxed text-[var(--muted)]">
      Sent the wrong amount, or nothing arrived?{' '}
      <a href={`mailto:support@solbazaar.com?subject=${encodeURIComponent(`Order ${orderNumber}`)}`} className="underline underline-offset-2">
        Contact support
      </a>{' '}
      with order <span className="font-mono">{orderNumber}</span> — include the transaction signature and we can trace it
      instantly.
    </p>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-none px-3.5 py-2.5 text-[12px] leading-relaxed"
      style={{ background: 'color-mix(in srgb, var(--warn) 13%, transparent)', color: 'var(--warn)' }}
      role="alert"
    >
      {children}
    </p>
  );
}

function Countdown({ ms }: { ms: number }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const urgent = total < 120;
  return (
    <span className="font-mono text-[13px] font-medium tabular-nums" style={urgent ? { color: 'var(--bad)' } : undefined} aria-live="polite">
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function calcRemaining(received: string, required: string): string {
  try {
    const r = BigInt(received);
    const q = BigInt(required);
    return r < q ? (q - r).toString() : '0';
  } catch {
    return required;
  }
}

/** Integer base units -> decimal string. Never uses floating point. */
export function formatAtomic(atomic: string | bigint, decimals: number): string {
  try {
    const v = BigInt(atomic);
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;
    if (frac === 0n) return `${neg ? '-' : ''}${whole}`;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${neg ? '-' : ''}${whole}.${fracStr}`;
  } catch {
    return '0';
  }
}

/**
 * Wallet deep link.
 *
 * Encoding the amount (rather than only the address) means the customer's
 * wallet pre-fills the correct value — removing the most common source of
 * underpayment. Most wallets also read the amount from the QR URI itself.
 */
function buildSolanaUri(address: string, p: Props['payment']): string | null {
  if (!address) return null;
  try {
    const params = new URLSearchParams({
      'amount': formatAtomic(p.remainingAtomic, p.decimals),
      'reference': p.depositAddress,
      'label': 'Sol Bazaar order payment',
      'message': 'Gift card purchase',
    });
    return `https://api.qrserver.com/v1/create-qr-code/?size=336x336&margin=8&data=${encodeURIComponent(
      `solana:${address}?${params.toString()}`,
    )}`;
  } catch {
    return null;
  }
}