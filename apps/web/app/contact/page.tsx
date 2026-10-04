import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Contact support',
  description: 'Get help with an order, a payment or a gift card code.',
};

export default function ContactPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-[32px] font-medium tracking-[-0.03em]">Contact support</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          We reply within one business day. Have your order number ready — it looks like{' '}
          <span className="font-mono font-semibold text-[var(--text)]">FC-XXXXXX</span> and appears at the top of your
          order page.
        </p>

        <div className="card mt-8 p-6">
          <h2 className="text-[15px] font-bold">Email</h2>
          <a
            href="mailto:support@solbazaar.com?subject=Order%20help"
            className="mt-2 inline-block font-mono text-[15px] font-bold underline underline-offset-4"
            style={{ color: 'var(--accent)' }}
          >
            support@solbazaar.com
          </a>
          <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--muted)]">
            Please include your order number and, if you have already paid, the transaction signature. That single detail
            lets us trace your payment instantly instead of searching.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="card p-5">
            <h2 className="text-[14px] font-bold">My payment went through but no code arrived</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
              Your order page updates automatically. If it still shows a pending payment after a few minutes, send us
              the signature and we will force the check.
            </p>
            <Link href="/orders" className="mt-3 inline-block text-[13px] font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
              Find my order →
            </Link>
          </div>

          <div className="card p-5">
            <h2 className="text-[14px] font-bold">I paid the wrong amount</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
              Send the difference to the same address — there is no need to start over, and the order stays valid until it
              expires.
            </p>
            <Link href="/faq#wrong-amount" className="mt-3 inline-block text-[13px] font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
              Read the details →
            </Link>
          </div>
        </div>

        <div
          className="mt-8 rounded-none p-5"
          style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)' }}
        >
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--bad)' }}>
            Beware of gift card scams
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
            Nobody from Sol Bazaar will ever contact you asking for your gift card code, your seed phrase, or your
            private key. Anyone who does is trying to steal your cards. Block them and report it to us.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}