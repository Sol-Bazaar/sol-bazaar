import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

/**
 * Order lookup.
 *
 * Gift card checkout is guest checkout by design — no account, no password,
 * nothing for a customer to store securely. That makes "find my order" the way
 * back in, so it takes both an order number and the email it was placed with.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-14 sm:px-6">
        <h1 className="text-[28px] font-medium tracking-[-0.025em]">Find my order</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
          Enter your order number and the email you used. No account needed.
        </p>

        {sp.error ? (
          <p
            className="mt-4 rounded-none px-3 py-2 text-[13px] font-medium"
            style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)' }}
            role="alert"
          >
            Please enter both fields.
          </p>
        ) : null}

        <form action="/api/order/lookup" method="GET" className="card mt-6 space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold">Order number</span>
            <input
              type="text"
              name="orderNumber"
              required
              placeholder="FC-XXXXXX"
              className="input font-mono uppercase"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold">Email address</span>
            <input type="email" name="email" required placeholder="you@example.com" className="input" autoComplete="email" />
          </label>

          <button type="submit" className="btn btn-primary btn-lg w-full">
            Find my order
          </button>
        </form>

        <div className="card mt-5 p-4">
          <h2 className="text-[13px] font-bold">Where do I find my order number?</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
            It is at the top of your order page and in the confirmation email we sent you. It looks like{' '}
            <span className="font-mono font-semibold text-[var(--text)]">FC-7KQ4M2</span>.
          </p>
          <Link href="/contact" className="mt-2.5 inline-block text-[12.5px] font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
            Lost it? Contact support
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}