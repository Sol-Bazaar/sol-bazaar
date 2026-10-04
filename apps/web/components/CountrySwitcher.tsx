'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { TOP_COUNTRIES, countryLabel, normaliseCountry } from '@solbazaar/core/client';

/**
 * Country picker.
 *
 * Changing the country reloads the page with `?country=XX`, which the middleware
 * stores in a cookie and forwards as `x-fc-country`. The server then re-runs
 * the catalogue query for that market — so what the visitor sees always matches
 * what they are actually allowed to buy.
 */
export function CountrySwitcher({ initial }: { initial?: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string>(initial ?? 'US');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { __FC__?: { country?: string } };
    if (w.__FC__?.country) setCurrent(w.__FC__.country);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (code: string) => {
    if (code === current) return setOpen(false);
    setCurrent(code);
    setOpen(false);
    document.cookie = `fc_country=${code}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    const qs = new URLSearchParams(window.location.search);
    qs.set('country', code);
    startTransition(() => router.replace(`${pathname}?${qs.toString()}`, { scroll: false }));
  };

  const flag = TOP_COUNTRIES.find((c) => c.code === current)?.flag ?? '\u{1F30D}';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-ghost h-9 !px-2.5 text-[13px]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Shopping region: ${countryLabel(current)}. Change`}
      >
        <span className="text-[15px] leading-none" aria-hidden>
          {flag}
        </span>
        <span className="hidden font-mono font-semibold sm:inline">{current}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="card absolute right-0 z-50 mt-2 w-72 overflow-hidden p-1.5 shadow-2xl"
          style={{ background: 'var(--surface)' }}
        >
          <div className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
            Available cards in your region
          </div>
          <div className="max-h-80 overflow-y-auto">
            {TOP_COUNTRIES.map((c) => (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={c.code === current}
                onClick={() => choose(c.code)}
                className="flex w-full items-center gap-2.5 rounded-none px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]"
              >
                <span className="text-[17px] leading-none" aria-hidden>
                  {c.flag}
                </span>
                <span className="flex-1">{c.label}</span>
                <span className="font-mono text-[11px] font-semibold text-[var(--muted)]">{c.code}</span>
                {c.code === current ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3.5" aria-hidden>
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--line)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
            We only show gift cards that can be legally redeemed in your region.
          </div>
        </div>
      ) : null}

      {pending ? <span className="sr-only">Updating region</span> : null}
    </div>
  );
}

export { normaliseCountry };