import { Suspense } from 'react';
import { getTenant } from '@/lib/tenant';
import { platformFeeConfig } from '@solbazaar/core';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { CartView } from '@/components/CartView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your cart' };

export default async function CartPage() {
  const tenant = await getTenant();
  const fees = platformFeeConfig();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-[28px] font-medium tracking-[-0.025em] sm:text-[34px]">Your cart</h1>
        <p className="mt-1.5 text-[14px] text-[var(--muted)]">
          Review your cards before we generate a payment address.
        </p>

        <div className="mt-8">
          <Suspense fallback={<div className="skeleton h-64 rounded-none" />}>
              <CartView minOrderUsd={Number(tenant.minOrderUsd)} platformFeeBps={fees.bps} />
            </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}