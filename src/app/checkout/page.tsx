import { Suspense } from 'react';
import { getTenant } from '@/lib/tenant';
import { brandOrDefaults } from '@/lib/tenant';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { CheckoutForm } from '@/components/CheckoutForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout', robots: { index: false } };

export default async function CheckoutPage() {
  const tenant = await getTenant();
  const brand = brandOrDefaults(tenant);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-full text-[13px] font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
            1
          </span>
          <div>
            <h1 className="text-[26px] font-medium tracking-[-0.025em]">Checkout</h1>
            <p className="text-[13px] text-[var(--muted)]">Tell us where to send your gift card codes.</p>
          </div>
        </div>

        <Suspense fallback={<div className="skeleton h-96 rounded-none" />}>
            <CheckoutForm />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}