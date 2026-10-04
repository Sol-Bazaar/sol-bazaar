'use client';

import { useState } from 'react';

export interface DisplayCode {
  code: string;
  pin: string | null;
  faceValue: string | null;
  currency: string | null;
  expiresAt: string | null;
  hint: string | null;
}

/**
 * Redeemable codes, rendered inline on the order page once payment completes.
 *
 * These are bearer instruments: whoever reads them can redeem them. So:
 *   - `select-text` is explicitly on, because a user copying a code is the
 *     normal case and a hidden code helps nobody.
 *   - The warning about sharing is prominent, because screenshots and scams are
 *     how these actually leak.
 *   - Nothing is logged or sent anywhere; the values arrive as server-rendered
 *     props and never touch a third party.
 */
export function InlineCodes({
  orderNumber,
  email,
  codes,
}: {
  orderNumber: string;
  email: string;
  codes: DisplayCode[];
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(true);

  const copyAll = async () => {
    const text = codes.map((c) => (c.pin ? `${c.code}\nPIN: ${c.pin}` : c.code)).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — codes are selectable below */
    }
  };

  return (
    <section
      className="card overflow-hidden"
      style={{ borderColor: 'color-mix(in srgb, var(--ok) 42%, transparent)' }}
      aria-labelledby="codes-heading"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        style={{ background: 'color-mix(in srgb, var(--ok) 10%, transparent)' }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-full"
            style={{ background: 'color-mix(in srgb, var(--ok) 22%, transparent)' }}
            aria-hidden
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <div>
            <h2 id="codes-heading" className="text-[15px] font-medium tracking-[-0.01em]">
              Your gift card {codes.length === 1 ? 'code' : 'codes'} are ready
            </h2>
            <p className="text-[11.5px] text-[var(--muted)]">
              Also emailed to {email} · order {orderNumber}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={copyAll} className="btn btn-primary btn-sm">
            {copied ? '✓ Copied' : 'Copy all'}
          </button>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="btn btn-ghost btn-sm"
            aria-pressed={!revealed}
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {codes.map((c, i) => (
          <div key={i} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {c.hint ? <div className="text-[12px] font-bold text-[var(--muted)]">{c.hint}</div> : null}

                {revealed ? (
                  <code className="mt-1 block select-all break-all font-mono text-[16px] font-bold tracking-wide">
                    {c.code}
                  </code>
                ) : (
                  <code className="mt-1 block select-none font-mono text-[16px] font-bold tracking-widest text-[var(--muted)]">
                    •••• •••• •••• ••••
                  </code>
                )}

                {c.pin ? (
                  <div className="mt-1.5 font-mono text-[13px] text-[var(--muted)]">
                    PIN{' '}
                    <span className="font-bold text-[var(--text)] select-all">{revealed ? c.pin : '••••'}</span>
                  </div>
                ) : null}

                {c.expiresAt ? (
                  <div className="mt-1 text-[11.5px]" style={{ color: 'var(--warn)' }}>
                    Expires {new Date(c.expiresAt).toLocaleDateString()}
                  </div>
                ) : null}
              </div>

              {c.faceValue ? (
                <div className="shrink-0 rounded-none border border-[var(--line)] px-2.5 py-1.5 text-right">
                  <div className="font-mono text-[13px] font-bold tabular-nums">
                    {c.currency ?? 'USD'} {Number(c.faceValue).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">face value</div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div
        className="border-t border-[var(--line)] px-5 py-4"
        style={{ background: 'color-mix(in srgb, var(--warn) 8%, transparent)' }}
      >
        <p className="text-[12px] font-bold" style={{ color: 'var(--warn)' }}>
          Anyone with these codes can spend the balance — treat them like cash.
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
          We will never contact you asking for them. To redeem: open the brand&apos;s site or app, choose
          &ldquo;Redeem code&rdquo; or &ldquo;Apply gift card&rdquo;, and enter the code exactly as shown. Save this
          page or the email before closing.
        </p>
        <div className="mt-3">
          <a
            href={`/order/${encodeURIComponent(orderNumber)}/codes?email=${encodeURIComponent(email)}`}
            className="text-[12px] font-semibold underline underline-offset-4"
            style={{ color: 'var(--accent)' }}
          >
            Open a dedicated code page →
          </a>
        </div>
      </div>
    </section>
  );
}