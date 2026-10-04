'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface Props {
  categories: { id: string; slug: string; name: string; icon: string | null; productCount: number }[];
  activeCategory?: string;
  q?: string;
}

/**
 * Category filter rail.
 *
 * Updates the existing query string instead of navigating to a new URL, so
 * `sort`, `q` and `country` all survive a category change.
 */
export function CatalogFilters({ categories, activeCategory, q }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-5">
      {q ? (
        <div className="card p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Search</div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-[13.5px] font-semibold">“{q}”</span>
            <button
              type="button"
              onClick={() => withParam('q', null)}
              className="shrink-0 text-[12px] font-semibold hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <nav aria-label="Categories">
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Categories</h2>
        <ul className="mt-2.5 space-y-0.5">
          <li>
            <FilterLink href={hrefFor(params, null)} active={!activeCategory} icon="🎯">
              All cards
            </FilterLink>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <FilterLink href={hrefFor(params, c.slug)} active={activeCategory === c.slug} icon={c.icon ?? '🎁'}>
                {c.name}
                <span className="ml-auto font-mono text-[11px] font-bold text-[var(--muted)]">{c.productCount}</span>
              </FilterLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="card p-4">
        <h2 className="text-[12.5px] font-bold">Availability</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
          You&apos;re seeing cards redeemable in your region. Gift card terms are set by each brand and vary by country.
        </p>
        <Link href="/faq#regions" className="mt-2.5 inline-block text-[12px] font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
          How this works
        </Link>
      </div>
    </div>
  );
}

function hrefFor(params: URLSearchParams, category: string | null): string {
  const next = new URLSearchParams(params.toString());
  if (category) next.set('category', category);
  else next.delete('category');
  const qs = next.toString();
  return qs ? `/products?${qs}` : '/products';
}

function FilterLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className="flex items-center gap-2.5 rounded-none px-2.5 py-2 text-[13.5px] font-medium transition-colors"
      style={
        active
          ? {
              background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
              color: 'var(--accent)',
              fontWeight: 700,
            }
          : { color: 'var(--muted)' }
      }
    >
      <span className="text-[15px] leading-none" aria-hidden>
        {icon}
      </span>
      {children}
    </Link>
  );
}