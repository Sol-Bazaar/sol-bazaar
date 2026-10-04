'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  orderNumber: string;
}

/**
 * Collects proof that the requester owns the order email.
 *
 * Order URLs are guessable by sequence, so payment details are only rendered
 * once the visitor supplies the email the order was placed with.
 */
export function OrderLookupGate({ orderNumber }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    setBusy(true);
    router.push(`/order/${orderNumber}?email=${encodeURIComponent(email.trim().toLowerCase())}`);
  };

  return (
    <div className="card p-7">
      <span
        className="grid h-11 w-11 place-items-center rounded-none"
        style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
        aria-hidden
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </span>

      <h1 className="mt-4 text-[21px] font-medium tracking-[-0.02em]">Confirm it&apos;s your order</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">
        Order <strong className="font-mono text-[var(--text)]">{orderNumber}</strong> exists. Enter the email address it
        was placed with to view the payment details.
      </p>

      <form onSubmit={onSubmit} className="mt-5">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold">Email address</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
            autoComplete="email"
            autoFocus
          />
        </label>
        <button type="submit" disabled={busy} className="btn btn-primary btn-lg mt-4 w-full">
          {busy ? 'Checking…' : 'View my order'}
        </button>
      </form>

      <p className="mt-5 text-[11.5px] leading-relaxed text-[var(--muted)]">
        We ask for this so nobody else can see your payment address or codes by guessing an order number.
      </p>
    </div>
  );
}

export function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async (text: string, key = 'default') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked — the value is selectable anyway */
    }
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { copied, copy };
}