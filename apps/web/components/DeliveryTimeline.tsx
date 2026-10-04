'use client';

import { useEffect, useState } from 'react';

/**
 * Delivery progress rail.
 *
 * Makes the "instant delivery" promise visible and auditable: order → payment
 * → codes issued → emailed, with the actual timestamps. If email delivery
 * failed we say so here rather than letting the customer conclude the order was
 * lost, because the codes are readable on this page regardless.
 */
export function DeliveryTimeline({
  createdAt,
  paidAt,
  codesIssuedAt,
  emailSentAt,
  deliveryLatencyMs,
  emailError,
  completed,
}: {
  createdAt: string;
  paidAt: string | null;
  codesIssuedAt: string | null;
  emailSentAt: string | null;
  deliveryLatencyMs: number | null;
  emailError: string | null;
  completed: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const steps = [
    { label: 'Order placed', at: createdAt, done: true },
    { label: 'Payment confirmed', at: paidAt, done: Boolean(paidAt) },
    { label: 'Codes issued', at: codesIssuedAt, done: Boolean(codesIssuedAt) },
    { label: 'Emailed', at: emailSentAt, done: Boolean(emailSentAt) },
  ];

  const current = steps.findIndex((s) => !s.done);
  const liveIndex = current === -1 ? steps.length - 1 : Math.max(0, current - 1);

  return (
    <div className="card p-4">
      <ol className="flex flex-wrap items-start gap-x-2 gap-y-3 sm:flex-nowrap">
        {steps.map((s, i) => {
          const active = i === liveIndex && !s.done;
          return (
            <li key={s.label} className="flex min-w-0 flex-1 items-start gap-2">
              <div className="flex flex-col items-center">
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10.5px] font-medium transition-colors"
                  style={
                    s.done
                      ? { background: 'var(--ok)', color: '#fff' }
                      : active
                        ? { background: 'var(--accent)', color: '#fff', animation: 'var(--animate-pulse-ring)' }
                        : { background: 'color-mix(in srgb, var(--elevated) 80%, transparent)', color: 'var(--muted)' }
                  }
                  aria-hidden
                >
                  {s.done ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                {/* Connector to the next step. */}
                {i < steps.length - 1 ? (
                  <span
                    className="mt-1 hidden h-6 w-px flex-1 sm:block"
                    style={{ background: steps[i + 1].done ? 'var(--ok)' : 'var(--line)' }}
                    aria-hidden
                  />
                ) : null}
              </div>
              <div className="min-w-0 pb-1">
                <div className="text-[11.5px] font-bold leading-tight">{s.label}</div>
                {/* 11px on phones: this line is the status the buyer is watching
                    for progress, so it must be readable at arm's length. 10px
                    from `sm` up keeps the timeline's visual rhythm. */}
                <div className="mt-0.5 font-mono text-[11px] text-[var(--muted)] sm:text-[10px]">
                  {s.at ? timeOf(s.at) : active ? 'working…' : 'pending'}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {completed && !emailSentAt && emailError ? (
        <p
          className="mt-3 rounded-none px-3 py-2 text-[12px] leading-relaxed"
          style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}
          role="status"
        >
          <strong>Your codes are ready</strong> — they are shown on this page. We couldn&apos;t send the email
          ({emailError}) and are retrying in the background. Nothing is lost.
        </p>
      ) : null}

      {deliveryLatencyMs != null ? (
        <p className="mt-3 text-[11.5px] text-[var(--muted)]">
          Delivered{' '}
          <strong className="text-[var(--text)]">{humanMs(deliveryLatencyMs)}</strong> after your payment confirmed
          {deliveryLatencyMs <= 240_000 ? ' — inside our 4-minute promise.' : '.'}
        </p>
      ) : null}

      {now < Date.now() ? null : null}
    </div>
  );
}

function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

function humanMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}