import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { TrackOrder } from '@/components/TrackOrder';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Live payment status and your gift card codes.',
  // A tracking link is a per-customer bearer page — keep it out of indexes.
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export interface PageProps {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
}

/**
 * Public order-tracking page.
 *
 * `/track/FC-XXXXXX?t=<token>` is the shareable, bookmarkable counterpart to the
 * emailed link: it keeps working on another device and shows the payment
 * timeline in real time, plus the codes once the payment settles.
 *
 * Access is by the opaque tracking token, not by email, so the URL never carries
 * a personal address into browser history, proxy logs or `Referer` headers.
 */
export default async function TrackPage({ params, searchParams }: PageProps) {
  const { orderNumber } = await params;
  const { t } = await searchParams;

  if (!t) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-lg px-4 py-16">
          <div className="card p-7">
            <h1 className="text-[20px] font-medium tracking-[-0.02em]">Tracking link incomplete</h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--muted)]">
              This page needs the full link, including the <code className="font-mono">?t=…</code> token. If you
              opened it from your order page or confirmation email the token is included automatically.
            </p>
            <Link href="/orders" className="btn btn-primary mt-6">
              Find my order with my email
            </Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <TrackOrder orderNumber={orderNumber.toUpperCase()} token={t} />
      </main>
      <SiteFooter />
    </>
  );
}