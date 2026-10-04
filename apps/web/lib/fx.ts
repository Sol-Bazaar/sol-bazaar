/**
 * Server-side FX access.
 *
 * Rates are read from `FxRate` (refreshed by the worker from the ECB feed) and
 * merged over `FALLBACK_RATES`. Two guarantees:
 *
 *   - **Never throws.** A currency layer that can 500 a product page is worse than
 *     one that shows a slightly stale rate, so a DB failure degrades to the
 *     static table rather than propagating.
 *   - **Settles in USD.** Nothing in this module is ever used to compute a crypto
 *     amount. `priceUsd` remains the single source of truth for what a customer
 *     is charged; these rates only render the number they read first.
 */
import { prisma } from '@solbazaar/db';
import { FALLBACK_RATES, currencyForCountry, type FxRates, type DisplayCurrency } from '@solbazaar/core';
import { createLogger } from '@solbazaar/core';

const log = createLogger({ service: 'fx' });

/** Refetch at most this often; the underlying source is daily anyway. */
const CACHE_TTL_MS = 10 * 60 * 1000;

let cached: { rates: FxRates; fetchedAt: number } | null = null;
let inflight: Promise<FxRates> | null = null;

/**
 * Current "units per USD" rates.
 *
 * Shared process-wide rather than per-request: the rates are daily, so a fresh
 * read on every one of 48 product cards would be pure waste.
 */
export async function getFxRates(): Promise<FxRates> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rates;
  // Collapse concurrent misses so a cold cache under load makes one query.
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const rows = await prisma.fxRate.findMany({
        where: { baseQuote: { startsWith: 'USD:' } },
        select: { baseQuote: true, rate: true },
      });
      const rates: FxRates = { ...FALLBACK_RATES };
      for (const r of rows) {
        const code = r.baseQuote.split(':')[1];
        const n = Number(r.rate);
        if (code && Number.isFinite(n) && n > 0) rates[code] = n;
      }
      rates.USD = 1;
      cached = { rates, fetchedAt: Date.now() };
      if (rows.length === 0) log.warn('fx_rates_empty', { hint: 'falling back to static table' });
      return rates;
    } catch (e) {
      log.warn('fx_rates_unavailable', { err: (e as Error).message });
      cached = { rates: { ...FALLBACK_RATES }, fetchedAt: Date.now() };
      return cached.rates;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export interface DisplayContext {
  /** Currency the visitor should see. */
  currency: DisplayCurrency;
  /** "Units per USD" — snapshotted onto orders so a receipt reproduces the quote. */
  rate: number;
  /** True when no live rate existed and the static table was used. */
  isFallback: boolean;
  /** When the persisted rate was last refreshed, for staleness display. */
  fetchedAt: string | null;
}

/** Everything a page needs to render local-currency prices. */
export async function getDisplayContext(country: string | null | undefined): Promise<DisplayContext> {
  const currency = currencyForCountry(country);
  const rates = await getFxRates();
  const row = currency === 'USD'
    ? null
    : await prisma.fxRate
        .findUnique({ where: { baseQuote: `USD:${currency}` }, select: { fetchedAt: true } })
        .catch(() => null);

  const rate = currency === 'USD' ? 1 : (rates[currency] ?? FALLBACK_RATES[currency] ?? 1);
  return {
    currency,
    rate,
    // Distinguishing "we have a live rate" from "this is a static guess" matters
    // because the two should be labelled differently to the customer.
    isFallback: !row,
    fetchedAt: row?.fetchedAt?.toISOString() ?? null,
  };
}