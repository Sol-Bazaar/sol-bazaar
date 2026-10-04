'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { InlineCodes, type DisplayCode } from './InlineCodes';
import { CopyAllButton } from './CopyAllButton';

interface Timeline {
  createdAt: string;
  paidAt: string | null;
  codesIssuedAt: string | null;
  emailSentAt: string | null;
  deliveryLatencyMs: number | null;
  withinSla: boolean | null;
}

interface Tx {
  signature: string;
  amountAtomic: string;
  confirmations: number;
  slot: number;
  finalized: boolean;
}

interface TrackData {
  orderNumber: string;
  status: string;
  fulfillmentStatus: string;
  failureReason: string | null;
  totals: { totalUsd: string; platformFeeUsd: string };
  items: { productName: string; productSlug: string; faceValue: string; currency: string; quantity: number }[];
  payment: {
    token: 'SOL' | 'USDC' | 'USDT';
    decimals: number;
    mint: string | null;
    depositAddress: string;
    associatedTokenAddress: string | null;
    requiredAtomic: string;
    receivedAtomic: string;
    remainingAtomic: string;
    paid: boolean;
    expired: boolean;
    expiresAt: string;
  };
  timeline: Timeline;
  transactions: Tx[];
  codes: DisplayCode[];
}

const POLL_MS = 5000;

/**
 * Live order tracking.
 *
 * Polls the tracking endpoint until the order settles, then shows the codes and
 * stops. Uses a visibility-aware pause so a backgrounded tab does not keep
 * hitting the API.
 */
export function TrackOrder({ orderNumber, token }: { orderNumber: string; token: string }) {
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef(false);

  const settled = data?.status === 'COMPLETED' || data?.status === 'FAILED' || data?.status === 'EXPIRED';

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(orderNumber)}?t=${encodeURIComponent(token)}`, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? 'This tracking link is not valid.');
        stopRef.current = true;
        return;
      }
      setData(body.data);
      setError(null);
      if (body.data.status === 'COMPLETED') stopRef.current = true;
    } catch {
      // Keep the last good state; a transient network blip is not fatal.
      setError((prev) => prev ?? 'Reconnecting…');
    } finally {
      setLoading(false);
    }
  }, [orderNumber, token]);

  useEffect(() => {
    stopRef.current = false;
    void load();
    const id = setInterval(() => {
      if (!stopRef.current && !document.hidden) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden && !stopRef.current) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Local countdown so the UI stays smooth between polls.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) {
    return (
      <div className="card p-6">
        <div className="skeleton h-5 w-40 rounded" />
        <div className="skeleton mt-4 h-24 w-full rounded-none" />
        <div className="skeleton mt-3 h-4 w-full rounded" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="card p-7 text-center">
        <h1 className="text-[19px] font-medium">We can&apos;t open this order</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-[var(--muted)]">{error}</p>
        <Link href="/orders" className="btn btn-primary mt-6">
          Find my order with my email
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const remaining = data.payment.remainingAtomic;
  const remainingDisplay = formatAtomic(remaining, data.payment.decimals);
  const expiresInMs = new Date(data.payment.expiresAt).getTime() - now;
  const expired = data.payment.expired || (expiresInMs <= 0 && !data.payment.paid);

  return (
    <div className="space-y-4">
      {/* ── Status header ──────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="badge" style={{ color: 'var(--accent)' }}>
              Order {data.orderNumber}
            </span>
            <h1 className="mt-2.5 text-[22px] font-medium tracking-[-0.02em]">
              {data.status === 'COMPLETED'
                ? 'Delivered 🎉'
                : data.status === 'FAILED'
                  ? 'Order failed'
                  : data.status === 'EXPIRED' || expired
                    ? 'Payment window closed'
                    : data.status === 'FULFILLING'
                      ? 'Issuing your codes…'
                      : 'Waiting for payment'}
            </h1>
            <p className="mt-1.5 text-[13px] text-[var(--muted)]">
              {data.status === 'COMPLETED'
                ? data.timeline.emailSentAt
                  ? 'Codes sent by email and shown below.'
                  : 'Your codes are ready and shown below. Email delivery is being retried.'
                : data.status === 'FULFILLING'
                  ? 'Payment confirmed. Issuing codes now — normally a few seconds.'
                  : data.payment.paid
                    ? 'Payment detected. Waiting for confirmation depth.'
                    : `Send ${remainingDisplay} ${data.payment.token} to the address below.`}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[17px] font-medium tabular-nums">${Number(data.totals.totalUsd).toFixed(2)}</div>
            <div className="text-[11px] text-[var(--muted)]">{data.items.length} item line(s)</div>
          </div>
        </div>

        {/* Progress rail */}
        <ol className="mt-5 grid gap-3 sm:grid-cols-4">
          <Step n={1} label="Order placed" at={data.timeline.createdAt} done />
          <Step n={2} label="Payment confirmed" at={data.timeline.paidAt} done={Boolean(data.timeline.paidAt)} />
          <Step n={3} label="Codes issued" at={data.timeline.codesIssuedAt} done={Boolean(data.timeline.codesIssuedAt)} />
          <Step n={4} label="Emailed to you" at={data.timeline.emailSentAt} done={Boolean(data.timeline.emailSentAt)} />
        </ol>

        {data.timeline.deliveryLatencyMs != null ? (
          <p
            className="mt-4 rounded-none px-3 py-2 text-[12px] font-medium"
            style={
              data.timeline.withinSla
                ? { background: 'color-mix(in srgb, var(--ok) 11%, transparent)', color: 'var(--ok)' }
                : { background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }
            }
          >
            Delivered {humanMs(data.timeline.deliveryLatencyMs)} after your payment confirmed
            {data.timeline.withinSla ? ' — inside our 4-minute promise.' : '.'}
          </p>
        ) : null}
      </div>

      {/* ── Codes ──────────────────────────────────────────────────────── */}
      {data.codes.length ? (
        <InlineCodes orderNumber={data.orderNumber} email="" codes={data.codes} />
      ) : data.status === 'COMPLETED' ? (
        <div className="card p-5 text-center">
          <p className="text-[13.5px] font-semibold">Your payment is confirmed but codes are not readable right now</p>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">
            Email delivery failed ({data.timeline.emailSentAt ? 'in progress' : 'see order status'}). This is almost
            always an email-provider issue, not a problem with your order. Contact support with your order number and
            we will send them again immediately.
          </p>
          <CopyAllButton codes={[]} />
        </div>
      ) : null}

      {/* ── Payment details while pending ───────────────────────────────── */}
      {!data.payment.paid ? (
        <div className="card p-5">
          <h2 className="text-[15px] font-bold">Payment details</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Amount to send</div>
              <div className="mt-1 font-mono text-[20px] font-medium tabular-nums">
                {remainingDisplay} <span className="text-[14px]">{data.payment.token}</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                {expired ? 'Window closed' : 'Expires in'}
              </div>
              <div
                className="mt-1 font-mono text-[20px] font-medium tabular-nums"
                style={expiresInMs < 120_000 && !expired ? { color: 'var(--bad)' } : undefined}
              >
                {expired ? '—' : countdown(expiresInMs)}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              {data.payment.token === 'SOL' ? 'Your Solana address' : 'Your token account address'}
            </div>
            <code className="mt-1.5 block break-all rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3 font-mono text-[12.5px]">
              {data.payment.token === 'SOL' ? data.payment.depositAddress : (data.payment.associatedTokenAddress ?? data.payment.depositAddress)}
            </code>
          </div>

          {data.payment.token !== 'SOL' ? (
            <p
              className="mt-3 rounded-none px-3 py-2.5 text-[12px] leading-relaxed"
              style={{ background: 'color-mix(in srgb, var(--warn) 13%, transparent)', color: 'var(--warn)' }}
            >
              You are paying with {data.payment.token} on Solana. Send {data.payment.token}, not SOL, to the
              address above — sending the wrong asset here means it cannot be detected.
            </p>
          ) : null}

          <p className="mt-3 text-[11.5px] text-[var(--muted)]">
            This page updates automatically every few seconds. Keep it open or bookmark it — the link keeps working.
          </p>
        </div>
      ) : null}

      {/* ── Transactions ────────────────────────────────────────────────── */}
      {data.transactions.length ? (
        <div className="card p-5">
          <h2 className="text-[15px] font-bold">On-chain transactions</h2>
          <ul className="mt-3 space-y-2">
            {data.transactions.map((t) => (
              <li key={t.signature} className="flex items-center justify-between gap-3 rounded-none border border-[var(--line)] px-3 py-2">
                <div className="min-w-0">
                  <code className="block truncate font-mono text-[11.5px]">{t.signature}</code>
                  <div className="text-[11px] text-[var(--muted)]">
                    slot {t.slot} · {t.confirmations} confirmation{t.confirmations === 1 ? '' : 's'}
                    {t.finalized ? ' · finalized' : ''}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[12.5px] font-bold tabular-nums">
                  {formatAtomic(t.amountAtomic, data.payment.decimals)} {data.payment.token}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Items ───────────────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="text-[15px] font-bold">Items</h2>
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {data.items.map((i, idx) => (
            <li key={idx} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{i.productName}</div>
                <div className="font-mono text-[11px] text-[var(--muted)]">
                  {i.currency} {Number(i.faceValue).toFixed(2)} × {i.quantity}
                </div>
              </div>
              <Link href={`/product/${i.productSlug}`} className="shrink-0 text-[12px] font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
                View
              </Link>
            </li>
          ))}
        </ul>
        {error && data ? (
          <p className="mt-3 text-[11.5px]" style={{ color: 'var(--warn)' }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Step({ n, label, at, done }: { n: number; label: string; at?: string | null; done: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium"
        style={
          done
            ? { background: 'var(--ok)', color: '#fff' }
            : { background: 'color-mix(in srgb, var(--elevated) 80%, transparent)', color: 'var(--muted)' }
        }
        aria-hidden
      >
        {done ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
        ) : (
          n
        )}
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-bold leading-tight">{label}</div>
        <div className="mt-0.5 font-mono text-[10.5px] text-[var(--muted)]">
          {at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'pending'}
        </div>
      </div>
    </li>
  );
}

function countdown(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function humanMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m} minute${m === 1 ? '' : 's'}`;
}

/** Integer base units -> decimal string. Never floating point. */
export function formatAtomic(atomic: string, decimals: number): string {
  try {
    const v = BigInt(atomic);
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;
    if (frac === 0n) return `${neg ? '-' : ''}${whole}`;
    return `${neg ? '-' : ''}${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
  } catch {
    return '0';
  }
}