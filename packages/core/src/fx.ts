/**
 * Local-currency display.
 *
 * ── The one rule that must not be broken ──────────────────────────────────
 * USD is the only *settlement* currency. The crypto amount a customer pays is
 * always derived from the USD total, never from a converted local amount.
 *
 * That is deliberate. We quote a local-currency price for readability, but the
 * order's crypto amount is locked at checkout against USD. If we instead derived
 * SOL from "€26.25", then a 2% move in EUR/USD between quote and payment would
 * silently change what the customer owes — or leave us short. The local figure is
 * presentational and the rate used is snapshotted onto the order so the receipt
 * always matches what they were shown.
 *
 * ── Where rates come from ──────────────────────────────────────────────────
 * `FxRate` rows, refreshed by the worker from the ECB reference feed. If no rate
 * is available we fall back to `FALLBACK_RATES`, so a cold database or a failed
 * refresh still renders a sane price instead of an error. Rates are advisory for
 * display; nothing financial depends on them being live.
 */
import Decimal from 'decimal.js';

/**
 * ISO 3166-1 country -> ISO 4217 currency.
 *
 * Curated rather than exhaustive. Gift cards are sold in a limited set of
 * markets, and an over-broad table would imply we support currencies our issuers
 * do not actually stock. Countries absent here fall back to USD, which is the
 * honest default: it never invents a local price for a market we can't serve.
 */
export const COUNTRY_CURRENCY: Record<string, string> = {
  // North America
  US: 'USD', CA: 'CAD', MX: 'MXN',
  // South America
  BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  // Europe
  GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
  NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR',
  LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
  CY: 'EUR', MT: 'EUR', HR: 'EUR',
  // Nordics
  SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK',
  // Central & Eastern Europe
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RS: 'RSD', UA: 'UAH',
  // Middle East & Africa
  AE: 'AED', SA: 'SAR', IL: 'ILS', TR: 'TRY', EG: 'EGP', ZA: 'ZAR', NG: 'NGN', KE: 'KES',
  // Asia-Pacific
  JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', TW: 'TWD', SG: 'SGD', MY: 'MYR',
  TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP', IN: 'INR', PK: 'PKR', BD: 'BDT',
};

/** Currencies we can display. Anything else is shown in USD. */
export const SUPPORTED_DISPLAY_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK',
  'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'AED', 'SAR', 'ILS', 'ZAR', 'INR', 'SGD',
  'MYR', 'THB', 'IDR', 'PHP', 'VND', 'CNY', 'HKD', 'KRW', 'BRL', 'MXN', 'ARS',
] as const;

export type DisplayCurrency = (typeof SUPPORTED_DISPLAY_CURRENCIES)[number];

/**
 * Currencies with no minor unit.
 *
 * Getting this wrong is the classic FX display bug: showing "¥1,577.00" when
 * the correct rendering is "¥1,577". Worth a table rather than a `=== 0` check
 * inline, because the list grows.
 */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF']);

/** Currencies whose symbol conventionally trails the amount (€25 vs 25 €). */
const SUFFIX_SYMBOL = new Set(['SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'BRL']);

export function minorUnits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/**
 * Last-resort rates, units of currency per 1 USD.
 *
 * Stale by construction — this exists so a cold start or a failed refresh shows a
 * plausible number instead of breaking the page. Never used to settle anything.
 * Roughly indicative only; the worker replaces these within minutes of boot.
 */
export const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.52, NZD: 1.64, JPY: 157,
  CHF: 0.89, SEK: 10.5, NOK: 10.7, DKK: 6.87, PLN: 3.97, CZK: 23.1,
  HUF: 360, RON: 4.58, TRY: 34.2, AED: 3.67, SAR: 3.75, ILS: 3.7,
  ZAR: 18.2, INR: 83.4, SGD: 1.34, MYR: 4.47, THB: 34.3, IDR: 16200,
  PHP: 58.3, VND: 25400, CNY: 7.24, HKD: 7.81, KRW: 1380, BRL: 5.42, MXN: 18.7,
  ARS: 950, CLP: 940, COP: 3900, PEN: 3.75,
};

/** Rates expressed as "units of currency per 1 USD". */
export type FxRates = Record<string, number>;

/** The currency a visitor should see prices in for a given country. */
export function currencyForCountry(country: string | null | undefined): DisplayCurrency {
  if (!country) return 'USD';
  const c = COUNTRY_CURRENCY[country.toUpperCase()];
  if (c && (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(c)) {
    return c as DisplayCurrency;
  }
  return 'USD';
}

/** Locale used for number formatting. Falls back to the currency's home market. */
export function localeForCurrency(currency: string, country?: string | null): string {
  if (country) {
    try {
      return Intl.NumberFormat.supportedLocalesOf([country]).length ? country : 'en-US';
    } catch {
      /* fall through */
    }
  }
  const map: Record<string, string> = {
    EUR: 'de-DE', GBP: 'en-GB', JPY: 'ja-JP', CAD: 'en-CA', AUD: 'en-AU',
    CHF: 'de-CH', SEK: 'sv-SE', NOK: 'nb-NO', DKK: 'da-DK', PLN: 'pl-PL',
    CZK: 'cs-CZ', HUF: 'hu-HU', INR: 'en-IN', BRL: 'pt-BR', MXN: 'es-MX',
    KRW: 'ko-KR', CNY: 'zh-CN', HKD: 'zh-HK', SGD: 'en-SG', ZAR: 'en-ZA',
  };
  return map[currency.toUpperCase()] ?? 'en-US';
}

/**
 * Convert a USD amount into `currency`.
 *
 * `rates` is "units per USD". Returns a Decimal so callers can keep full
 * precision until the moment they format — never round twice.
 */
export function convertFromUsd(
  usd: Decimal.Value,
  currency: string,
  rates: FxRates = FALLBACK_RATES,
): Decimal {
  const code = currency.toUpperCase();
  if (code === 'USD') return new Decimal(usd);
  const rate = rates[code] ?? FALLBACK_RATES[code];
  if (!rate || !Number.isFinite(rate) || rate <= 0) {
    // A missing rate must not produce a $0 price. Degrade to USD rather than
    // showing something free.
    return new Decimal(usd);
  }
  return new Decimal(usd).mul(rate);
}

/** The rate to snapshot on an order so the receipt reproduces the quote. */
export function rateFor(currency: string, rates: FxRates = FALLBACK_RATES): number {
  const code = currency.toUpperCase();
  if (code === 'USD') return 1;
  const r = rates[code] ?? FALLBACK_RATES[code];
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/**
 * Format a converted amount for display.
 *
 * Uses `Intl.NumberFormat` so grouping separators and symbol placement are
 * correct per locale. Falls back to a plain `CUR 12.34` if the runtime rejects
 * the currency code, because an unformatted number beats a thrown error inside a
 * render.
 */
export function formatMoney(
  amount: Decimal.Value,
  currency: string,
  opts: { locale?: string; country?: string | null; showCode?: boolean } = {},
): string {
  const code = currency.toUpperCase();
  const locale = opts.locale ?? localeForCurrency(code, opts.country);
  const decimals = minorUnits(code);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      ...(opts.showCode ? { currencyDisplay: 'code' } : {}),
    }).format(new Decimal(amount).toNumber());
  } catch {
    return `${code} ${new Decimal(amount).toFixed(decimals)}`;
  }
}

/** Convenience: USD -> visitor currency -> formatted string. */
export function formatConverted(
  usd: Decimal.Value,
  currency: string,
  rates: FxRates = FALLBACK_RATES,
  opts: { locale?: string; country?: string | null } = {},
): string {
  const code = currency.toUpperCase();
  if (code === 'USD') return formatMoney(usd, 'USD', opts);
  return formatMoney(convertFromUsd(usd, code, rates), code, opts);
}

/**
 * Round a converted amount to something a human would type.
 *
 * Half-up to the currency's minor units, so €26.25 not €26.2543. Purely cosmetic
 * — settlement still uses the exact USD total.
 */
export function roundForDisplay(amount: Decimal, currency: string): Decimal {
  return amount.toDecimalPlaces(minorUnits(currency), Decimal.ROUND_HALF_UP);
}

export { SUFFIX_SYMBOL };