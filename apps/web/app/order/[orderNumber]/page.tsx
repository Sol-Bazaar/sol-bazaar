import { notFound } from 'next/navigation';
import { prisma, OrderStatus } from '@solbazaar/db';
import { revealCodes } from '@solbazaar/fulfillment';
import { getTenant, getGeo } from '@/lib/tenant';
import { getDisplayContext, getFxRates } from '@/lib/fx';
import { getPriceBoard } from '@/lib/pricing';
import { formatCrypto, formatUsd, requiredAtomic, formatConverted } from '@solbazaar/core';
import { tokenInfo, explorerUrl } from '@solbazaar/crypto';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PaymentPanel } from '@/components/PaymentPanel';
import { OrderLookupGate } from '@/components/OrderLookupGate';
import { InlineCodes } from '@/components/InlineCodes';
import { TrackingLink } from '@/components/TrackingLink';
import { DeliveryTimeline } from '@/components/DeliveryTimeline';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Complete your payment', robots: { index: false } };

interface PageProps {
  searchParams: Promise<{ email?: string; created?: string }>;
  params: Promise<{ orderNumber: string }>;
}

export default async function OrderPage({ params, searchParams }: PageProps) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const tenant = await getTenant();

  const order = await prisma.order.findFirst({
    where: {
      tenantId: tenant.id,
      OR: [{ orderNumber: orderNumber.toUpperCase() }, { id: orderNumber }],
    },
    include: {
      // Scalars (codesIssuedAt, emailSentAt, deliveryLatencyMs, emailError,
      // paidAt, createdAt) are returned automatically — `include` is for
      // relations only.
      items: true,
      txs: { orderBy: { seenAt: 'desc' }, take: 5 },
      fulfillments: { select: { status: true, codeCount: true, failureReason: true, deliveredAt: true } },
    },
  });

  if (!order) notFound();

  /*
   * Payment details are bearer-like information: anyone with the order number
   * could otherwise learn a deposit address and watch it. When the requester
   * has not proven ownership of the email, show the lookup gate instead.
   */
  const emailProof = sp.email?.trim().toLowerCase();
  if (!emailProof && order.email && sp.created !== '1') {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-md px-4 py-16">
          <OrderLookupGate orderNumber={order.orderNumber} />
        </main>
        <SiteFooter />
      </>
    );
  }

  const token = order.token === 'USDT' ? 'USDC' : order.token; // USDT removed from supported tokens
  const info = tokenInfo(token as 'SOL' | 'USDC', process.env.SOLANA_CLUSTER !== 'mainnet-beta');
  const isDevnet = process.env.SOLANA_CLUSTER !== 'mainnet-beta';
  const required = requiredAtomic(BigInt(order.expectedAtomic), order.toleranceBps);
  const received = BigInt(order.receivedAtomic);
  const remaining = received < required ? required - received : 0n;

  /*
   * Codes are decrypted here, on the server, only once the requester has proven
   * ownership of the order email. They are shown inline (not behind another
   * click) because the email is the primary channel but people lose email.
   */
  const codes = order.status === OrderStatus.COMPLETED ? await revealCodes(order.id) : [];

  const shortByUsd =
    received > 0n && received < required
      ? formatUsd(order.totalUsd.mul(1).minus(order.totalUsd.mul(String(received)).div(String(order.expectedAtomic))))
      : null;

  /*
   * Local-currency view of the total, for the rate disclosure under the amount.
   *
   * Resolved from the *visitor's* country rather than the order's — someone who
   * travels mid-payment should still see a figure they recognise.
   *
   * Presentational only. The crypto amount is derived from the USD total and is
   * what they must actually send; this exists so the number they recognise sits
   * next to it, with the rate stated rather than hidden.
   */
  const [geo, fxRates, priceBoard] = await Promise.all([getGeo(), getFxRates(), getPriceBoard()]);
  const displayCtx = await getDisplayContext(geo.country);
  const tokenUsd = Number(priceBoard.find((p) => p.symbol === order.token)?.usd ?? '1');
  const usdTotalStr = order.totalUsd.toFixed(2);

  const display = {
    currency: displayCtx.currency,
    usdTotal: usdTotalStr,
    localTotal:
      displayCtx.currency === 'USD'
        ? null
        : formatConverted(order.totalUsd, displayCtx.currency, fxRates, { country: geo.country }),
    rateText: tokenUsd > 0 ? tokenUsd.toFixed(2) : '',
  };

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-7">
          <span
            className="badge"
            style={
              order.status === 'COMPLETED'
                ? { color: 'var(--ok)', borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)' }
                : undefined
            }
          >
            Order {order.orderNumber}
          </span>
          <h1 className="mt-3 text-[26px] font-medium tracking-[-0.025em] sm:text-[32px]">
            {order.status === 'COMPLETED'
              ? 'Payment confirmed'
              : order.status === 'EXPIRED'
                ? 'This order expired'
                : order.status === 'FAILED'
                  ? 'Order failed'
                  : 'Send your payment'}
          </h1>
          <p className="mt-1.5 text-[14px] text-[var(--muted)]">
            Codes are emailed to <strong className="text-[var(--text)]">{maskEmail(order.email)}</strong> and shown
            here the moment the payment confirms.
          </p>

          {/* Delivery progress + shareable tracking link. */}
          <div className="mt-5">
            <DeliveryTimeline
              createdAt={order.createdAt.toISOString()}
              paidAt={order.paidAt?.toISOString() ?? null}
              codesIssuedAt={order.codesIssuedAt?.toISOString() ?? null}
              emailSentAt={order.emailSentAt?.toISOString() ?? null}
              deliveryLatencyMs={order.deliveryLatencyMs}
              emailError={order.emailError}
              completed={order.status === OrderStatus.COMPLETED}
            />
            <div className="mt-3">
              <TrackingLink orderNumber={order.orderNumber} />
            </div>
          </div>
        </div>

        {order.status === 'EXPIRED' ? (
          <div className="card mb-6 border-l-4 p-5" style={{ borderLeftColor: 'var(--warn)' }}>
            <h2 className="text-[15px] font-bold">The payment window closed</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">
              Orders expire after {tenant.orderTtlMinutes} minutes so we don&apos;t hold your address open indefinitely.
              Any funds that arrive after expiry are not automatically refunded —{' '}
              <a href={`mailto:${tenant.supportEmail ?? 'support@solbazaar.com'}`} className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>
                contact support
              </a>{' '}
              with your order number and we will return them.
            </p>
            <a href="/products" className="btn btn-primary mt-4">
              Start a new order
            </a>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <PaymentPanel
            orderNumber={order.orderNumber}
            status={order.status}
            fulfillmentStatus={order.fulfillmentStatus}
            payment={{
              token: order.token,
              tokenName: info.name,
              mint: order.mintAddress,
              decimals: order.tokenDecimals,
              amountCrypto: formatCrypto(String(order.amountCrypto), order.tokenDecimals, 9),
              requiredAtomic: required.toString(),
              receivedAtomic: order.receivedAtomic,
              remainingAtomic: remaining.toString(),
              depositAddress: order.depositAddress,
              ata: order.depositAta,
              expiresAt: order.expiresAt.toISOString(),
              confirmations: order.confirmations,
              toleranceBps: order.toleranceBps,
              shortByUsd,
            }}
            transactions={order.txs.map((t) => ({
              signature: t.signature,
              amountAtomic: t.atomicAmount,
              confirmations: t.confirmations,
              slot: t.slot,
            }))}
            explorerBase={explorerUrl('SIGNATURE_PLACEHOLDER', isDevnet)}
              isDevnet={isDevnet}
              display={display}
            email={order.email}
          />

            {/* Codes, shown inline as soon as the payment completes. */}
            {order.status === OrderStatus.COMPLETED && codes.length ? (
              <InlineCodes
                orderNumber={order.orderNumber}
                email={order.email}
                codes={codes.map((c) => ({
                  code: c.code,
                  pin: c.pin,
                  faceValue: c.faceValue,
                  currency: c.currency,
                  expiresAt: c.expiresAt,
                  hint:
                    order.items.find(
                      (i) => c.faceValue && Number(i.faceValue) === Number(c.faceValue),
                    )?.productName ?? null,
                }))}
              />
            ) : null}

            {order.status === OrderStatus.FULFILLING ? (
              <div className="card p-5">
                <div className="flex items-center gap-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin text-[var(--accent)]" aria-hidden>
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity=".25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                  </svg>
                  <div>
                    <div className="text-[14px] font-bold">Payment confirmed — generating your codes</div>
                    <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
                      This usually takes a few seconds. They will appear here and in your inbox.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Order contents */}
          <aside className="space-y-4">
            <div className="card p-5">
              <h2 className="text-[15px] font-bold">Your order</h2>
              <ul className="mt-3.5 divide-y divide-[var(--line)]">
                {order.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold">{i.productName}</div>
                      <div className="font-mono text-[11px] text-[var(--muted)]">
                        ${Number(i.faceValue).toLocaleString('en-US')} × {i.quantity}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums">
                      ${Number(i.lineTotalUsd).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 space-y-2 border-t border-[var(--line)] pt-3.5 text-[12.5px]">
                <div className="flex justify-between">
                  <dt className="text-[var(--muted)]">Card value</dt>
                  <dd className="font-mono tabular-nums">${Number(order.subtotalUsd).toFixed(2)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--muted)]">Processing</dt>
                  <dd className="font-mono tabular-nums">
                    ${(Number(order.totalUsd) - Number(order.subtotalUsd)).toFixed(2)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-[var(--line)] pt-2 text-[15px]">
                  <dt className="font-bold">Total</dt>
                  <dd className="font-mono font-medium tabular-nums">${Number(order.totalUsd).toFixed(2)}</dd>
                </div>
              </dl>
            </div>

            <div className="card p-4">
              <h3 className="text-[12.5px] font-bold">Payment status</h3>
              <dl className="mt-2.5 space-y-1.5 text-[12px]">
                <Row label="Status" value={order.status.replace(/_/g, ' ').toLowerCase()} />
                <Row label="Fulfilment" value={order.fulfillmentStatus.toLowerCase()} />
                <Row label="Payments received" value={order.paymentTxCount.toString()} />
                <Row label="Required" value={`${order.expectedAtomic} (${order.token})`} mono />
                {order.paidAt ? <Row label="Confirmed" value={order.paidAt.toISOString().slice(11, 19) + ' UTC'} /> : null}
              </dl>
              {order.failureReason ? (
                <p className="mt-3 rounded-none px-2.5 py-2 text-[11.5px]" style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)' }}>
                  {order.failureReason}
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className={`truncate font-semibold ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  );
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}