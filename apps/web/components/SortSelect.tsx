'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const SORTS = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'popular', label: 'Most popular' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'newest', label: 'Newest' },
];

export function SortSelect({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="relative">
      <span className="sr-only">Sort products</span>
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('sort', e.target.value);
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        className="input h-10 cursor-pointer appearance-none pr-9 text-[13.5px] font-semibold"
        style={{ minWidth: 190 }}
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value} style={{ background: 'var(--surface)' }}>
            {s.label}
          </option>
        ))}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}