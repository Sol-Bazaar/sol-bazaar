'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCopyToClipboard } from './OrderLookupGate';
import { 
  Copy, 
  Check, 
  QrCode, 
  AlertTriangle, 
  Clock, 
  Loader2, 
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Send,
  Wallet,
  Shield,
  Info
} from 'lucide-react';

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
  display?: {
    currency: string;
    usdTotal: string;
    localTotal: string | null;
    rateText: string;
  };
}

export function PaymentPanel({ orderNumber, status, payment, transactions, explorerBase, isDevnet, email, display }: Props) {
  const router = useRouter();
  const { copied, copy } = useCopyToClipboard();

  const [remaining, setRemaining] = useState(calcRemaining(payment.receivedAtomic, payment.requiredAtomic));
  const [expiresIn, setExpiresIn] = useState(() => new Date(payment.expiresAt).getTime() - Date.now());
  const [pollError, setPollError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [copiedItem, setCopiedItem] = useState<'address' | 'amount' | null>(null);

  const isSettled = status === 'COMPLETED' || status === 'PAID' || status === 'FULFILLING';
  const expired = expiresIn <= 0 && !isSettled;

  const sendAddress = payment.token === 'SOL' ? payment.depositAddress : (payment.ata ?? payment.depositAddress);

  useEffect(() => {
    const t = setInterval(() => setExpiresIn(new Date(payment.expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [payment.expiresAt]);

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

  const handleCopy = (type: 'address' | 'amount', value: string) => {
    copy(value, type);
    setCopiedItem(type);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  const formatTime = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return { m, s, urgent: total < 120 };
  };

  if (isSettled) {
    return <SuccessBanner orderNumber={orderNumber} email={email} />;
  }
  if (expired) {
    return <ExpiredBanner />;
  }

  const time = formatTime(expiresIn);

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        {/* ── Amount to send ── */}
        <div className="border-b border-[var(--line)] px-6 py-8 text-center">
          <div className="t-label">Send exactly</div>
          <div className="mt-2 font-mono text-[36px] font-medium leading-none tabular-nums sm:text-[44px]">
            {formatAtomic(remaining, payment.decimals)} <span className="text-[22px] sm:text-[26px]">{payment.token}</span>
          </div>
          {payment.token !== 'SOL' && (
            <p className="mt-2 text-[12px] text-[var(--muted)]">on Solana · {isDevnet ? 'devnet' : 'mainnet-beta'}</p>
          )}

          {display && display.currency !== 'USD' && display.localTotal ? (
            <p className="mx-auto mt-3 max-w-sm text-[11.5px] leading-relaxed text-[var(--muted)]">
              ≈ <span className="font-medium text-[var(--text)]">{display.localTotal}</span> · converted from $
              {display.usdTotal} at 1 {payment.token} ≈ {display.rateText}
            </p>
          ) : display?.usdTotal ? (
            <p className="mt-3 text-[11.5px] text-[var(--muted)]">≈ ${display.usdTotal}</p>
          ) : null}

          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] px-3 py-1.5">
            <Clock className="h-3.5 w-3.5" style={{ color: time.urgent ? 'var(--bad)' : 'var(--muted)' }} />
            <span className="font-mono text-[13px] font-medium tabular-nums" style={{ color: time.urgent ? 'var(--bad)' : 'var(--text)' }}>
              {time.m}:{String(time.s).padStart(2, '0')}
            </span>
            <span className="text-[12px] text-[var(--muted)]">until expiry</span>
          </div>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr]">
          {/* ── QR Code ── */}
          <div className="mx-auto sm:mx-0">
            <div className="relative">
              <div className="rounded-none bg-white p-4" style={{ animation: 'var(--animate-pulse-ring)' }}>
                {qr ? (
                  <img 
                    src={qr} 
                    alt={`QR code to send ${payment.token} to your payment address`} 
                    width={200} 
                    height={200} 
                    className="block mx-auto"
                  />
                ) : (
                  <div className="grid h-[200px] w-[200px] place-items-center text-[11px] text-black/50">
                    <QrCode className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    QR unavailable
                  </div>
                )}
              </div>
              <button
                onClick={() => handleCopy('address', sendAddress)}
                className="absolute bottom-2 right-2 btn btn-ghost btn-sm bg-[var(--surface)] border-[var(--line)]"
                aria-label="Copy address"
              >
                {copiedItem === 'address' ? <Check className="h-3.5 w-3.5 text-[var(--ok)]" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-[var(--muted)]">Scan with your wallet</p>
          </div>

          {/* ── Address + Amount + Guidance ── */}
          <div className="min-w-0 space-y-5">
            {/* Address section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="t-label flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
                  {payment.token === 'SOL' ? 'Your Solana address' : `${payment.token} address on Solana`}
                </span>
                <button
                  onClick={() => handleCopy('address', sendAddress)}
                  className="btn btn-ghost btn-sm"
                  aria-label="Copy payment address"
                >
                  {copiedItem === 'address' ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--ok)' }}>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-medium">
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </span>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--muted)]">
                <Shield className="h-3.5 w-3.5" />
                Unique to this order · one-time use only
              </div>

              <div className="rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3">
                <code className="block break-all font-mono text-[12.5px] leading-relaxed">{sendAddress}</code>
              </div>

              {/* Amount to send */}
              <div className="flex items-center justify-between gap-2 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] px-3 py-2.5">
                <div>
                  <div className="t-label">Amount to send</div>
                  <div className="mt-0.5 font-mono text-[16px] font-medium tabular-nums">
                    {formatAtomic(remaining, payment.decimals)} {payment.token}
                  </div>
                </div>
                <button
                  onClick={() => handleCopy('amount', `${formatAtomic(remaining, payment.decimals)} ${payment.token}`)}
                  className="btn btn-ghost btn-sm"
                  aria-label="Copy payment amount"
                >
                  {copiedItem === 'amount' ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--ok)' }}>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-medium">
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </span>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                Base units: <span className="font-mono">{remaining}</span>
              </p>
            </div>

            {/* SPL token warning */}
            {payment.token !== 'SOL' && (
              <div className="flex gap-2.5 rounded-none border border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-3.5" role="alert">
                <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
                <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--warn)' }}>
                  You are paying with <strong>{payment.token}</strong>. Send it in your wallet's <strong>{payment.token}</strong> token
                  on <strong>Solana</strong>. Sending SOL to this address, or {payment.token} on another chain, will not
                  be detected and your funds will be lost.
                </div>
              </div>
            )}

            {/* ATA warning for SPL */}
            {payment.token !== 'SOL' && payment.ata && sendAddress !== payment.depositAddress && (
              <div className="rounded-none border border-[var(--line)] p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Owner address (do not use for {payment.token})</div>
                <code className="mt-1 block break-all font-mono text-[11.5px] text-[var(--muted)]">{payment.depositAddress}</code>
              </div>
            )}

            {/* Steps */}
            <ol className="space-y-2.5 text-[12.5px] text-[var(--muted)]">
              {[
                `Open your wallet's send screen for ${payment.token} on Solana.`,
                'Paste the address above, or scan the QR code.',
                `Send exactly ${formatAtomic(remaining, payment.decimals)} ${payment.token} — sending less means we cannot issue your card.`,
                'Come back to this page. Your card is delivered automatically once the payment confirms.',
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[10.5px] font-medium" style={{ color: 'var(--accent)' }}>
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
                className="ml-auto text-[11.5px] text-[var(--muted)] underline underline-offset-2 flex items-center gap-1"
              >
                JSON
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {pollError && (
              <div className="flex gap-2.5 rounded-none border border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-3" role="status">
                <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
                <p className="text-[12px]" style={{ color: 'var(--warn)' }}>{pollError}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detected transactions */}
      {transactions.length > 0 && (
        <div className="card p-5">
          <h2 className="text-[14px] font-bold flex items-center gap-2">
            <Send className="h-4 w-4" style={{ color: 'var(--accent)' }} />
            Payments detected
          </h2>
          <ul className="mt-3 space-y-2">
            {transactions.map((t) => (
              <li key={t.signature} className="flex items-center justify-between gap-3 rounded-none border border-[var(--line)] px-3 py-2.5">
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
                    className="text-[11.5px] text-[var(--muted)] underline underline-offset-2 flex items-center gap-1"
                  >
                    View
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SupportNote orderNumber={orderNumber} />
    </div>
  );
}

// ── Sub-components ──

function SuccessBanner({ orderNumber, email }: { orderNumber: string; email: string }) {
  return (
    <div className="card p-8 text-center" style={{ borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' }}>
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--ok) 16%, transparent)' }}>
        <CheckCircle2 className="h-8 w-8" style={{ color: 'var(--ok)' }} />
      </div>
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
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ background: 'color-mix(in srgb, var(--warn) 16%, transparent)' }}>
        <XCircle className="h-8 w-8" style={{ color: 'var(--warn)' }} />
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
      <a href={`mailto:support@solbazaar.com?subject=${encodeURIComponent(`Order ${orderNumber}`)}`} className="underline underline-offset-2 flex items-center justify-center gap-1">
        <Info className="h-3.5 w-3.5" />
        Contact support
      </a>{' '}
      with order <span className="font-mono">{orderNumber}</span> — include the transaction signature and we can trace it
      instantly.
    </p>
  );
}

// ── Helpers ──

function calcRemaining(received: string, required: string): string {
  try {
    const r = BigInt(received);
    const q = BigInt(required);
    return r < q ? (q - r).toString() : '0';
  } catch {
    return required;
  }
}

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

function buildSolanaUri(address: string, p: Props['payment']): string | null {
  if (!address) return null;
  try {
    const params = new URLSearchParams({
      'amount': formatAtomic(p.remainingAtomic, p.decimals),
      'reference': p.depositAddress,
      'label': 'Sol Bazaar order payment',
      'message': 'Gift card purchase',
    });
    return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=12&data=${encodeURIComponent(
      `solana:${address}?${params.toString()}`,
    )}`;
  } catch {
    return null;
  }
}