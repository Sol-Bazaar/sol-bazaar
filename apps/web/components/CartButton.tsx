'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCart } from './CartProvider';

export function CartButton() {
  const { count, hydrated } = useCart();
  const [bump, setBump] = useState(false);

  useEffect(() => {
    if (count > 0) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 400);
      return () => clearTimeout(t);
    }
  }, [count]);

  return (
    <Link
      href="/cart"
      className="btn btn-ghost relative h-10 sm:h-9 w-9 !px-0"
      aria-label={`Cart, ${hydrated ? count : 0} items`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
      </svg>
      {hydrated && count > 0 ? (
        <span
          className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-medium text-white tabular-nums transition-transform"
          style={{
            background: 'var(--accent)',
            transform: bump ? 'scale(1.28)' : 'scale(1)',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}