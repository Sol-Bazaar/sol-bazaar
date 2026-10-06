'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCart } from './CartProvider';
import { ShoppingBag } from 'lucide-react';

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
      <ShoppingBag className="h-5 w-5" />
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