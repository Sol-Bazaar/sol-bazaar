'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, DollarSign } from 'lucide-react';

/**
 * Live SOL price chip.
 *
 * Reads the server-fetched board once on mount, then refreshes every 60s. The
 * price is *indicative* here — the amount a customer actually pays is locked at
 * checkout, which is what the order page shows.
 */
export function TokenTicker() {
  const [price, setPrice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/v1/catalog?limit=1', { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const body = await res.json();
        const sol = body?.data?.priceBoard?.find((p: any) => p.symbol === 'SOL');
        if (alive && sol?.usd) setPrice(sol.usd);
      } catch {
        /* ticker is decorative */
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <span
      className="hidden h-10 items-center gap-1.5 rounded-none border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-2.5 text-[12px] font-semibold sm:inline-flex sm:h-9"
      title="Indicative SOL price. The exact amount is fixed when you check out."
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ok)] opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
      </span>
      <span className="text-[var(--muted)]">SOL</span>
      <span className="font-mono tabular-nums">{price ? `$${Number(price).toFixed(2)}` : '—'}</span>
      {price && (
        <TrendingUp className="h-3 w-3 text-[var(--ok)]" />
      )}
    </span>
  );
}