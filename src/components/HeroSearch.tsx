'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Sparkles } from 'lucide-react';

const SUGGESTIONS = ['Netflix', 'Spotify', 'Amazon', 'PlayStation', 'Xbox', 'Steam', 'Apple', 'Roblox'];

export function HeroSearch({ placeholder = 'Search Netflix, Steam, PlayStation…' }: { placeholder?: string }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (value: string) => {
    const term = value.trim();
    if (!term) return router.push('/products');
    startTransition(() => router.push(`/products?q=${encodeURIComponent(term)}`));
  };

  return (
    <div className="relative mx-auto max-w-xl">
      <form onSubmit={(e) => { e.preventDefault(); submit(q); }} role="search">
        <div className="card flex items-center gap-2 p-1.5 pl-4 transition-shadow focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]">
          <Search width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" className="shrink-0" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 140)}
            placeholder={placeholder}
            aria-label="Search gift cards"
            className="w-full bg-transparent py-2.5 text-[14.5px] outline-none placeholder:text-[color-mix(in_srgb,var(--muted)_75%,transparent)]"
          />
          <button type="submit" className="btn btn-primary btn-sm shrink-0" disabled={pending}>
            {pending ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {focused && !q ? (
        <div className="card absolute inset-x-0 top-full z-30 mt-2 p-2.5" style={{ background: 'var(--surface)' }}>
          <div className="flex items-center gap-1.5 px-1.5 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
            <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
            Popular brands
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submit(s)}
                className="badge py-1.5 text-[12px] font-semibold transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}