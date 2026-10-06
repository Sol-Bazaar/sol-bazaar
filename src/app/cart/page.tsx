import { Suspense } from 'react';
import Link from 'next/link';
import { getTenant } from '@/lib/tenant';
import { brandOrDefaults } from '@/lib/tenant';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ProductCard, ProductCardSkeleton } from '@/components/ProductCard';
import { CheckoutForm } from '@/components/CheckoutForm';
import { CartContent } from '@/components/CartContent';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const tenant = await getTenant();
  const brand = brandOrDefaults(tenant);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center gap-3">
          <h1 className="text-[26px] font-medium tracking-[-0.025em]">Cart</h1>
        </div>

        <Suspense fallback={<div className="skeleton h-64 rounded-none" />}>
          <CartContent />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}