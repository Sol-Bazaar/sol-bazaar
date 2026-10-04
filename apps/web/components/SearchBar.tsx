'use client';

import { useEffect, useRef, useState, useTransition, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export interface SearchHit {
  slug: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryName: string;
  categorySlug: string;
  priceFrom: string;
  minFace: number | null;
}

/**
 * Catalogue search with live suggestions.
 *
 * Two behaviours, because they serve different intents:
 *   - **As you type** → a dropdown of matching cards (fastest path to an item).
 *   - **Enter / click** → pushes `?q=` so the full results page renders
 *     server-side and the URL is shareable/bookmarkable.
 *
 * Debounced to 220ms and aborts in-flight requests, so typing fast does not
 * queue a burst of catalogue queries.
 */
export function SearchBar({
  autoFocus,
  placeholder = 'Search gift cards, brands, categories…',
  size = 'md',
}: {
  autoFocus?: boolean;
  placeholder?: string;
  size?: 'md' | 'lg';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cursor = useRef(-1);

  // Keep in sync when the URL changes (back button, category click, etc).
  useEffect(() => {
    setTerm(params.get('q') ?? '');
  }, [params]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    if (q.trim().length < 1) {
      setHits([]);
      setBusy(false);
      return;
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    try {
      const next = new URLSearchParams(params.toString());
      next.set('q', q);
      next.set('limit', '8');
      const res = await fetch(`/api/v1/catalog?${next.toString()}`, {
        signal: ctl.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return;
      const body = await res.json();
      const products = body?.data?.products ?? [];
      const cats = body?.data?.categories ?? [];
      const mapped: SearchHit[] = [
        // Category matches first — "vpn" should surface the category too.
        ...cats
          .filter((c: any) => String(c.name).toLowerCase().includes(q.toLowerCase()))
          .slice(0, 2)
          .map((c: any) => ({
            slug: '',
            name: c.name,
            shortName: null,
            logoUrl: null,
            categoryName: 'Category',
            categorySlug: c.slug,
            priceFrom: '',
            minFace: null,
            isCategory: true,
          })),
        ...products.map((p: any) => ({
          slug: p.slug,
          name: p.name,
          shortName: p.shortName,
          logoUrl: p.logoUrl,
          categoryName: p.category?.name ?? '',
          categorySlug: p.category?.slug ?? '',
          priceFrom: p.priceFromUsd ? `$${Number(p.priceFromUsd).toFixed(2)}` : '',
          minFace: p.minFaceValue,
        })),
      ];
      if (alive(ctl)) setHits(mapped.slice(0, 8));
    } catch {
      /* aborted or offline — keep the previous suggestions */
    } finally {
      if (alive(ctl)) setBusy(false);
    }
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => void search(term), 220);
    return () => clearTimeout(t);
  }, [term, search]);

  const submit = (value = term) => {
    setOpen(false);
    const next = new URLSearchParams(pathname === '/products' ? params.toString() : '');
    if (value.trim()) next.set('q', value.trim());
    else next.delete('q');
    // A new search resets the paging/filter context.
    next.delete('cursor');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !hits.length) {
      if (e.key === 'Enter') submit();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor.current = Math.min(cursor.current + 1, hits.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursor.current = Math.max(cursor.current - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[cursor.current];
      if (cursor.current >= 0 && hit) go(hit);
      else submit();
    }
  };

  const go = (hit: SearchHit & { isCategory?: boolean }) => {
    setOpen(false);
    if ((hit as any).isCategory) {
      router.push(`/products?category=${hit.categorySlug}`);
      return;
    }
    router.push(`/product/${hit.slug}`);
  };

  return (
    <div className="relative" ref={ref}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          className={`card flex items-center gap-2 transition-shadow focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)] ${size === 'lg' ? 'px-4 py-1' : 'p-1.5 pl-3.5'}`}
        >
          <svg
            width={size === 'lg' ? 19 : 17}
            height={size === 'lg' ? 19 : 17}
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="shrink-0"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>

          <input
            type="search"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
              cursor.current = -1;
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Search gift cards"
            aria-expanded={open && hits.length > 0}
            aria-controls="search-suggestions"
            role="combobox"
            aria-autocomplete="list"
            autoFocus={autoFocus}
            className={`w-full bg-transparent outline-none placeholder:text-[color-mix(in_srgb,var(--muted)_75%,transparent)] ${size === 'lg' ? 'py-3 text-[15px]' : 'py-2 text-[14px]'}`}
          />

          {term ? (
            <button
              type="button"
              onClick={() => {
                setTerm('');
                submit('');
              }}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-none text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)] hover:text-[var(--text)]"
              aria-label="Clear search"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          ) : null}

          {busy ? (
            <svg width="15" height="15" viewBox="0 0 24 24" className="shrink-0 animate-spin text-[var(--muted)]" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity=".25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </svg>
          ) : null}

          <button type="submit" className={`btn btn-primary shrink-0 ${size === 'lg' ? '' : 'btn-sm'}`} disabled={pending}>
            Search
          </button>
        </div>
      </form>

      {open && hits.length > 0 ? (
        <ul
          id="search-suggestions"
          role="listbox"
          className="card absolute left-0 right-0 z-50 mt-2 overflow-hidden p-1.5 shadow-2xl"
          style={{ background: 'var(--surface)' }}
        >
          {hits.map((h, i) => (
            <li key={`${h.categorySlug}-${h.slug}-${i}`} role="option" aria-selected={i === cursor.current}>
              <button
                type="button"
                onMouseEnter={() => {
                  cursor.current = i;
                }}
                onClick={() => go(h as any)}
                className="flex w-full items-center gap-3 rounded-none px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]"
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-none border border-white/10 bg-[color-mix(in_srgb,var(--elevated)_70%,transparent)] text-[10px] font-medium"
                >
                  {h.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : (
                    (h.shortName || h.name).slice(0, 2).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{h.name}</span>
                  <span className="block truncate text-[11.5px] text-[var(--muted)]">
                    {h.categoryName}
                    {h.minFace ? ` · from $${Number(h.minFace).toLocaleString('en-US')}` : ''}
                  </span>
                </span>
                {h.priceFrom ? (
                  <span className="shrink-0 font-mono text-[12.5px] font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                    {h.priceFrom}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          <li className="border-t border-[var(--line)] px-1 pt-1.5">
            <button
              type="button"
              onClick={() => submit()}
              className="w-full rounded-none px-2 py-2 text-left text-[12.5px] font-semibold hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]"
              style={{ color: 'var(--accent)' }}
            >
              See all results for “{term}” →
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function alive(ctl: AbortController): boolean {
  return !ctl.signal.aborted;
}