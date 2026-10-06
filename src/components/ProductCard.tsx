import Link from 'next/link';
import type { Product } from '@/lib/catalog';
import { formatUsd } from '@/lib/utils';
import { BrandLogo } from './BrandLogo';
import { ChevronRight, Star, Tag, CircleDollarSign } from 'lucide-react';

interface Props {
  product: Product;
  compact?: boolean;
  priority?: boolean;
}

export function ProductCard({ product, compact = false, priority = false }: Props) {
  const soldOut = !product.inStock;
  const name = product.shortName || product.name;

  return (
    <Link
      href={`/product/${product.slug}`}
      className="brackets brackets-hover group relative flex flex-col border border-[var(--grid)] transition-colors duration-150 hover:bg-[var(--elevated)] focus-visible:bg-[var(--elevated)]"
      aria-label={`${product.name} gift card`}
    >
      <div className={`flex items-start gap-3 ${compact ? 'p-3' : 'p-4'}`}>
        <BrandLogo slug={product.slug} name={name} src={product.logoUrl} size={compact ? 'sm' : 'md'} />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-medium leading-tight">{name}</h3>
          {!compact && product.brand ? (
            <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{product.brand.name}</p>
          ) : null}

          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="t-num text-[14px] font-medium tabular-nums">
              {product.displayPriceFrom ?? (product.priceFromUsd > 0 ? formatUsd(product.priceFromUsd) : '—')}
            </span>
            {product.priceFromUsd > 0 ? (
              <span className="text-[11px] text-[var(--faint)]">from</span>
            ) : null}
            {product.rating ? (
              <span className="t-num inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
                <Star className="h-3 w-3 fill-current" style={{ color: 'var(--warn)' }} />
                {product.rating.toFixed(1)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {!compact && product.denominations.length ? (
        <div className="mt-auto flex flex-wrap gap-1 px-4 pb-3">
          {product.denominations.slice(0, 4).map((d) => (
            <span
              key={`${d.faceValue}-${d.currency}`}
              className="t-num border border-[var(--line)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--muted)]"
            >
              {d.currency === 'USD' ? '$' : ''}
              {Number(d.faceValue).toLocaleString('en-US')}
            </span>
          ))}
          {product.denominations.length > 4 ? (
            <span className="t-num px-0.5 py-0.5 text-[11px] text-[var(--faint)]">
              +{product.denominations.length - 4}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--grid)] px-4 py-1.5">
        <span className="t-label truncate">
          <Tag className="h-3 w-3 inline mr-1" style={{ verticalAlign: 'middle' }} />
          {product.category.name}
        </span>
        {soldOut ? (
          <span className="t-label shrink-0 text-[var(--faint)]">Sold out</span>
        ) : product.displayCurrency && product.displayCurrency !== 'USD' ? (
          <span className="t-label shrink-0" title={`Converted from USD at ${product.displayRate}`}>
            ≈ USD
          </span>
        ) : (
          <span className="t-label shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 flex items-center gap-1">
            Buy
            <ChevronRight className="h-3 w-3" />
          </span>
        )}
      </div>

      {soldOut ? (
        <div className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_78%,transparent)]">
          <span className="badge px-3 py-1.5">Out of stock</span>
        </div>
      ) : null}
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="border border-[var(--grid)]">
      <div className="flex items-start gap-3 p-4">
        <div className="skeleton h-11 w-11" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="skeleton h-3.5 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
          <div className="skeleton h-3 w-1/3" />
        </div>
      </div>
      <div className="flex gap-1.5 px-4 pb-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-5 w-11" />
        ))}
      </div>
      <div className="border-t border-[var(--grid)] px-4 py-2">
        <div className="skeleton h-2.5 w-16" />
      </div>
    </div>
  );
}