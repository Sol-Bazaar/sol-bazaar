/**
 * Background maintenance: expiry sweeps, webhook delivery, issuer polling,
 * recurring price/inventory syncs.
 *
 * Everything here is safe to run on multiple processes — claims use
 * `SKIP LOCKED` and state transitions are conditional.
 */
import { prisma, OrderStatus, FulfillmentStatus, JobType, TokenSymbol } from '@solbazaar/db';
import { enqueue, requeue } from '@solbazaar/jobs';
import { claimDueDeliveries, deliverDelivery, publish, pollPendingFulfillments } from '@solbazaar/fulfillment';
import { bootstrapProviders } from '@solbazaar/provider';
import { createLogger, sleep, mapLimit, SUPPORTED_DISPLAY_CURRENCIES } from '@solbazaar/core';

const log = createLogger({ service: 'sweeper' });

/**
 * Expire unpaid orders and return their reserved stock.
 *
 * The stock release matters: without it a customer who abandons checkout would
 * permanently shrink the catalogue, and a popular card would appear sold out
 * forever. Using a conditional update on `status` makes this idempotent.
 */
export async function sweepExpiredOrders(limit = 100): Promise<number> {
  const now = new Date();

  // 1. Mark expired.
  const expired = await prisma.order.updateMany({
    where: { status: OrderStatus.PENDING_PAYMENT, expiresAt: { lt: now } },
    data: { status: OrderStatus.EXPIRED },
  });

  if (expired.count === 0) return 0;

  // 2. Release their reservations.
  const stale = await prisma.order.findMany({
    where: { status: OrderStatus.EXPIRED, updatedAt: { gt: new Date(now.getTime() - 60_000) } },
    select: { id: true, orderNumber: true, items: { select: { productId: true, quantity: true } } },
    take: limit,
  });

  let released = 0;
  for (const order of stale) {
    await prisma.$transaction(async (t) => {
      for (const item of order.items) {
        await t.product.update({
          where: { id: item.productId },
          // Floor at 0 so a double-release cannot push stock negative.
          data: { reservedStock: { decrement: item.quantity } },
        });
        const after = await t.product.findUnique({ where: { id: item.productId }, select: { reservedStock: true } });
        if (after && after.reservedStock < 0) {
          await t.product.update({ where: { id: item.productId }, data: { reservedStock: 0 } });
        }
      }
      // Tag the row so we never process the same order twice.
      await t.order.update({
        where: { id: order.id },
        data: { failureReason: 'expired_unpaid_stock_released' },
      });
    });
    await enqueue('SEND_WEBHOOK', { orderId: order.id, event: 'order.expired' }, { dedupeKey: `wh:exp:${order.id}` });
    released++;
  }

  log.info('orders_expired', { expired: expired.count, stockReleased: released });
  return released;
}

/** Flush due webhook deliveries. */
export async function flushWebhooks(): Promise<number> {
  const ids = await claimDueDeliveries(20);
  if (!ids.length) return 0;
  await mapLimit(ids, 5, (id) => deliverDelivery(id));
  return ids.length;
}

/** Poll issuers for orders that never produced codes. */
export async function pollIssuers(): Promise<number> {
  try {
    bootstrapProviders();
    return await pollPendingFulfillments(25);
  } catch (e) {
    log.warn('poll_issuers_failed', { err: (e as Error).message });
    return 0;
  }
}

/** Orders that timed out mid-fulfilment — surfaced for operator attention. */
export async function findStuckFulfillments(minutes = 20): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60_000);
  const stuck = await prisma.order.findMany({
    where: { status: OrderStatus.FULFILLING, updatedAt: { lt: cutoff } },
    select: { id: true, orderNumber: true, updatedAt: true },
    take: 50,
  });
  if (stuck.length) {
    log.warn('stuck_fulfillments', {
      count: stuck.length,
      orders: stuck.slice(0, 10).map((o) => o.orderNumber),
    });
  }
  return stuck.length;
}

/** Orders that received a partial payment but then expired. */
export async function findAbandonedPartialPayments(): Promise<number> {
  const rows = await prisma.order.findMany({
    where: {
      status: OrderStatus.EXPIRED,
      receivedAtomic: { not: '0' },
    },
    select: { id: true, orderNumber: true, receivedAtomic: true, token: true, totalUsd: true },
    take: 50,
  });

  for (const o of rows) {
    log.warn('refund_needed_expired_with_payment', {
      orderNumber: o.orderNumber,
      received: o.receivedAtomic,
      token: o.token,
      usd: String(o.totalUsd),
      action: 'operator must return funds manually',
    });
  }
  if (rows.length) log.error('abandoned_partial_payments', { count: rows.length });
  return rows.length;
}

/**
 * Keep token prices fresh so checkout quotes are not stale.
 *
 * Implemented here rather than imported so the worker stays independent of the
 * web app. The oracle logic is intentionally identical to the web app's — the
 * last value written to `TokenPrice` wins, so whichever process runs most
 * recently keeps the stored price accurate.
 */
export async function refreshTokenPrices(): Promise<void> {
  try {
    // Stablecoins default to parity; only SOL needs an external oracle.
    const stables: [TokenSymbol, number][] = [
      [TokenSymbol.USDC, 1],
      [TokenSymbol.USDT, 1],
    ];
    for (const [symbol, usd] of stables) {
      await prisma.tokenPrice.upsert({
        where: { symbol },
        create: { symbol, usd: String(usd), source: 'parity' },
        update: { usd: String(usd), source: 'parity', fetchedAt: new Date() },
      });
    }

    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { solana?: { usd?: number } };
    const usd = json.solana?.usd;
    if (!usd || usd <= 0) throw new Error('no price in response');

    await prisma.tokenPrice.upsert({
      where: { symbol: TokenSymbol.SOL },
      create: { symbol: TokenSymbol.SOL, usd: String(usd), source: 'coingecko' },
      update: { usd: String(usd), source: 'coingecko', fetchedAt: new Date() },
    });
    log.info('prices_refreshed', { sol: usd });
  } catch (e) {
    // Non-fatal: the web app falls back to the last persisted price.
    log.warn('price_refresh_failed', { err: (e as Error).message });
  }
}

/**
 * Refresh USD -> local-currency rates used for *display*.
 *
 * Source is the ECB reference feed (frankfurter.app), which needs no API key and
 * publishes a date we can record. ECB rates are once-daily reference rates, not
 * a live market — deliberately the right choice here, because these figures only
 * ever render a price a customer reads before paying. Settlement is always the
 * USD total, so a stale display rate can never change what anyone is charged.
 *
 * Failure is non-fatal: the web app falls back to the last persisted rate and
 * then to `FALLBACK_RATES`, so an outage here degrades the label, not the page.
 */
export async function refreshFxRates(): Promise<void> {
  const wanted = SUPPORTED_DISPLAY_CURRENCIES.filter((c) => c !== 'USD');

  /*
   * The maintenance loop runs every 60s; ECB publishes once a day. Without this
   * guard we would make ~1,440 identical requests a day, which is rude to a free
   * community endpoint and gets us rate-limited. Six hours is comfortably inside
   * the daily refresh while tolerating a few failed attempts.
   */
  const MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const freshest = await prisma.fxRate
    .findFirst({ where: { baseQuote: { startsWith: 'USD:' } }, orderBy: { fetchedAt: 'desc' } })
    .catch(() => null);
  if (freshest && Date.now() - freshest.fetchedAt.getTime() < MAX_AGE_MS) return;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${wanted.join(',')}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { rates?: Record<string, number>; date?: string };
    const rates = json.rates ?? {};
    if (Object.keys(rates).length === 0) throw new Error('no rates in response');

    let n = 0;
    for (const [code, rate] of Object.entries(rates)) {
      if (!Number.isFinite(rate) || rate <= 0) continue;
      // Guard against a nonsense rate replacing a good one. A 50x move in a
      // reference rate is a data error, not a market event.
      const prev = await prisma.fxRate.findUnique({ where: { baseQuote: `USD:${code}` } });
      if (prev) {
        const ratio = rate / Number(prev.rate);
        if (Number.isFinite(ratio) && (ratio > 1.5 || ratio < 0.667)) {
          log.warn('fx_rate_implausible', { code, prev: String(prev.rate), next: rate });
          continue;
        }
      }
      await prisma.fxRate.upsert({
        where: { baseQuote: `USD:${code}` },
        create: { baseQuote: `USD:${code}`, rate: String(rate), source: `ecb:${json.date ?? 'unknown'}` },
        update: { rate: String(rate), source: `ecb:${json.date ?? 'unknown'}`, fetchedAt: new Date() },
      });
      n++;
    }
    log.info('fx_refreshed', { count: n, date: json.date ?? 'unknown' });
  } catch (e) {
    log.warn('fx_refresh_failed', { err: (e as Error).message });
  }
}

/**
 * Republish a fulfilment that completed before its webhook was configured. */
export async function ensureFulfillmentWebhooks(): Promise<number> {
  const recent = await prisma.order.findMany({
    where: { status: OrderStatus.COMPLETED, updatedAt: { gt: new Date(Date.now() - 3_600_000) } },
    select: { id: true },
    take: 50,
  });
  let sent = 0;
  for (const o of recent) {
    const n = await publish('order.fulfilled', { orderId: o.id });
    sent += n;
  }
  return sent;
}

/**
 * Instant-delivery SLA monitor.
 *
 * Two regressions are easy to miss until customers complain, so we look for both
 * explicitly on every maintenance pass:
 *
 *  1. **Paid but never issued** — the chain watcher saw the payment but the
 *     job queue has not delivered codes. This is the worst case: the customer
 *     has paid and is staring at a blank page.
 *  2. **Issued but never emailed** — codes exist but the email provider is
 *     failing. Less urgent (the order page still shows the codes) but it silently
 *     destroys the "instant delivery" promise.
 *
 * Both are logged at error level with the affected order numbers, and reported
 * by `/api/health` so a load balancer / alerting pipeline can act on them.
 */
export async function checkDeliverySla(): Promise<{
  paidNotIssued: number;
  issuedNotEmailed: number;
  breaches: number;
}> {
  const now = Date.now();
  const SLOW_MS = Number(process.env.DELIVERY_SLA_MS ?? 4 * 60 * 1000);

  const [paidNotIssued, issuedNotEmailed, breaches] = await Promise.all([
    prisma.order.count({
      where: {
        status: { in: ['PAID', 'FULFILLING'] },
        paidAt: { lt: new Date(now - SLOW_MS) },
      },
    }),
    prisma.order.count({
      where: {
        status: 'COMPLETED',
        emailSentAt: null,
        updatedAt: { lt: new Date(now - SLOW_MS) },
      },
    }),
    prisma.order.count({
      where: {
        status: 'COMPLETED',
        deliveryLatencyMs: { gt: SLOW_MS },
        emailSentAt: { not: null },
      },
    }),
  ]);

  if (paidNotIssued > 0) {
    const rows = await prisma.order.findMany({
      where: { status: { in: ['PAID', 'FULFILLING'] }, paidAt: { lt: new Date(now - SLOW_MS) } },
      select: { orderNumber: true, paidAt: true, status: true },
      orderBy: { paidAt: 'asc' },
      take: 10,
    });
    // Re-drive fulfilment. `requeue` (not `enqueue`) because a DEAD row from an
    // earlier failed attempt would make a plain enqueue a permanent no-op.
    const stuckIds = await prisma.order.findMany({
      where: { status: { in: ['PAID', 'FULFILLING'] }, paidAt: { lt: new Date(now - SLOW_MS) } },
      select: { id: true },
      take: 25,
    });
    let requeued = 0;
    for (const r of stuckIds) {
      const ok = await requeue('FULFILL_ORDER', { orderId: r.id }, { dedupeKey: `fulfill:${r.id}` }).catch(() => false);
      if (ok) requeued++;
    }
    log.error('sla_breach_paid_not_issued', {
      count: paidNotIssued,
      oldest: rows[0]?.paidAt?.toISOString(),
      orders: rows.map((r) => `${r.orderNumber}(${r.status})`),
      requeued,
      action: requeued > 0 ? 're-queued fulfilment' : 'check job queue depth + issuer API availability',
    });
  }

  if (issuedNotEmailed > 0) {
    const rows = await prisma.order.findMany({
      where: { status: 'COMPLETED', emailSentAt: null, updatedAt: { lt: new Date(now - SLOW_MS) } },
      select: { orderNumber: true, emailError: true },
      take: 10,
    });
    log.error('sla_breach_not_emailed', {
      count: issuedNotEmailed,
      orders: rows.map((r) => r.orderNumber),
      lastError: rows.find((r) => r.emailError)?.emailError,
      note: 'codes are still available on the order page and tracking link',
    });
  }

  if (breaches > 0) {
    log.warn('sla_slow_delivery', { count: breaches, thresholdMs: SLOW_MS });
  }

  return { paidNotIssued, issuedNotEmailed, breaches };
}

/** The maintenance loop. */
export async function startMaintenance(intervalMs = 60_000): Promise<() => void> {
  let stopped = false;
  log.info('maintenance_started', { intervalMs });

  const loop = async () => {
    while (!stopped) {
      try {
        await sweepExpiredOrders();
        await flushWebhooks();
        await pollIssuers();
        await findStuckFulfillments();
        await findAbandonedPartialPayments();
        await checkDeliverySla();
        await refreshFxRates();
      } catch (e) {
        log.error('maintenance_iteration_failed', { err: (e as Error).message });
      }
      await sleep(intervalMs);
    }
  };

  void loop();
  return () => {
    stopped = true;
    log.info('maintenance_stopping');
  };
}

export { enqueue, JobType, FulfillmentStatus };