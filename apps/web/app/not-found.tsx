import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center sm:px-6">
        <span
          className="grid h-16 w-16 place-items-center rounded-none text-[28px]"
          style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
          aria-hidden
        >
          🎁
        </span>
        <h1 className="mt-6 text-[34px] font-medium tracking-[-0.03em]">We couldn&apos;t find that page</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          The link may be out of date, or the gift card may no longer be available in your region.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
          <Link href="/products" className="btn btn-ghost">
            Browse gift cards
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}