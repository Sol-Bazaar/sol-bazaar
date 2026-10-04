import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma, OrderStatus } from '@solbazaar/db';
import { revealCodes } from '@solbazaar/fulfillment';
import { getTenant } from '@/lib/tenant';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { CopyAllButton } from '@/components/CopyAllButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your gift card codes', robots: { index: false, noarchive: true } };

interface PageProps {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ email?: string }>;
}

/**
 * Customer-facing code redemption page.
 *
 * Authorisation is by exact email match against the order — the same proof the
 * payment page requires. Codes are decrypted only for the order that has just
 * been matched, so there is no path from this page to another customer's codes.
 */
export default async function CodesPage({ params, searchParams }: PageProps) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const email = (sp.email ?? '').trim().toLowerCase();
  if (!email) redirect(`/order/${orderNumber}`);

  const tenant = await getTenant();
  const order = await prisma.order.findFirst({
    where: { orderNumber: orderNumber.toUpperCase(), email, tenantId: tenant.id },
    include: { items: true },
  });

  if (!order) notFound();

  if (order.status !== OrderStatus.COMPLETED) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-lg px-4 py-20">
          <div className="card p-8 text-center">
            <div className="text-[36px]" aria-hidden>
              ⏳
            </div>
            <h1 className="mt-4 text-[20px] font-medium">Not ready yet</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">
              {order.status === OrderStatus.PENDING_PAYMENT
                ? 'We have not received your payment yet. Codes appear here the moment it confirms.'
                : `This order is ${order.status.toLowerCase().replace(/_/g, ' ')}.`}
            </p>
            <Link href={`/order/${order.orderNumber}?email=${encodeURIComponent(email)}`} className="btn btn-primary mt-6">
              Back to the order
            </Link>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const codes = await revealCodes(order.id);
  const groupable = codes.map((c) => ({
    ...c,
    // Match each code back to the line it came from, when face values differ.
    hint: order.items.find((i) => c.faceValue && Number(i.faceValue) === Number(c.faceValue))?.productName ?? null,
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-7 text-center">
          <span
            className="mx-auto grid h-16 w-16 place-items-center rounded-full"
            style={{ background: 'color-mix(in srgb, var(--ok) 16%, transparent)' }}
            aria-hidden
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <h1 className="mt-5 text-[26px] font-medium tracking-[-0.025em]">Your gift cards</h1>
          <p className="mt-1.5 text-[14px] text-[var(--muted)]">
            Order <span className="font-mono font-semibold">{order.orderNumber}</span> · {codes.length} code
            {codes.length === 1 ? '' : 's'} · also sent to <strong className="text-[var(--text)]">{email}</strong>
          </p>
        </div>

        <div className="space-y-2.5">
          {groupable.map((c, i) => (
            <div key={i} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                {c.hint ? <div className="text-[12.5px] font-bold">{c.hint}</div> : null}
                <code className="block break-all font-mono text-[15px] font-bold tracking-wide">{c.code}</code>
                {c.pin ? (
                  <div className="mt-1 font-mono text-[12.5px] text-[var(--muted)]">
                    PIN <span className="font-bold text-[var(--text)]">{c.pin}</span>
                  </div>
                ) : null}
                {c.expiresAt ? (
                  <div className="mt-1 text-[11.5px]" style={{ color: 'var(--warn)' }}>
                    Expires {new Date(c.expiresAt).toLocaleDateString()}
                  </div>
                ) : null}
              </div>
              <div className="text-right">
                {c.faceValue ? (
                  <div className="font-mono text-[14px] font-bold tabular-nums">
                    {c.currency ?? 'USD'} {Number(c.faceValue).toFixed(2)}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <CopyAllButton codes={groupable.map((c) => (c.pin ? `${c.code}\nPIN: ${c.pin}` : c.code))} />
          <Link href="/products" className="btn btn-ghost">
            Buy more cards
          </Link>
        </div>

        <div className="card mt-6 p-4">
          <h2 className="text-[13px] font-bold">Redeeming your codes</h2>
          <ol className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
            <li>1. Open the brand&apos;s website or app on the same account you want the credit on.</li>
            <li>2. Choose “Redeem code”, “Gift card” or “Apply gift card”.</li>
            <li>3. Enter the code exactly as shown, including any PIN.</li>
          </ol>
          <p className="mt-3 text-[12px] leading-relaxed text-[color-mix(in_srgb,var(--muted)_80%,transparent)]">
            Nobody from {tenant.name} will ever ask you for these codes. If someone does, it is a scam — block them and
            contact us.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}