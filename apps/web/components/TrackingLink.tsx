'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Shareable tracking link.
 *
 * The link embeds the order's opaque tracking token, which the server handed us
 * once at order creation (via a short-lived, httpOnly, same-site cookie set on
 * the redirect to this page). The token is never rendered into server HTML —
 * only the already-authorised customer sees this component.
 *
 * If the cookie is absent (returning visitor on a new device) we fall back to
 * the email lookup rather than showing a broken link.
 */
export function TrackingLink({ orderNumber }: { orderNumber: string }) {
  const [copied, setCopied] = useState(false);
  const [href, setHref] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const resolve = async () => {
    setChecked(true);
    try {
      // The tracking token was stashed at checkout; this endpoint echoes the
      // canonical link built from the session-bound token.
      const res = await fetch(`/api/order/${encodeURIComponent(orderNumber)}/tracking-link`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const body = await res.json();
        if (body?.data?.url) setHref(body.data.url);
        return;
      }
    } catch {
      /* fall through to the email route */
    }
    setHref(null);
  };

  const url = href ?? `${typeof window !== 'undefined' ? window.location.origin : ''}/order/${orderNumber}`;

  const copy = async () => {
    if (!href) {
      void resolve();
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard unavailable — the field is selectable */
    }
  };

  return (
    <div className="rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="text-[13px] font-bold">Track this order</span>
        </div>
        <Link
          href={`/track/${orderNumber}`}
          className="text-[12px] font-semibold underline underline-offset-4"
          style={{ color: 'var(--accent)' }}
        >
          Open live tracker →
        </Link>
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--muted)]">
        A bookmarkable link that shows your payment progress in real time and your codes once confirmed — works on any
        device, no login needed.
      </p>

      <div className="mt-2.5 flex gap-2">
        <input
          readOnly
          value={href ? url : (checked ? 'Generating your private tracking link…' : '••••••••••••••••••••••••••••')}
          onFocus={(e) => {
            if (!href) void resolve();
          }}
          aria-label="Tracking link"
          className="input h-9 flex-1 font-mono text-[11.5px] text-[var(--muted)]"
        />
        <button type="button" onClick={copy} className="btn btn-ghost btn-sm h-9 shrink-0">
          {copied ? '✓ Copied' : href ? 'Copy' : 'Get link'}
        </button>
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-[color-mix(in_srgb,var(--muted)_78%,transparent)]">
        The link contains a private random token — treat it like a password, since anyone holding it can view this
        order&apos;s codes.
      </p>
    </div>
  );
}