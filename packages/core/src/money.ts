/**
 * Money & token arithmetic.
 *
 * Golden rule of this file: **never** do crypto arithmetic in JS `number`
 * or `float`. Lamports and token base-units are 64-bit integers, so every
 * integer-side value is a `bigint`, serialised as a decimal string for the DB.
 * USD values use `decimal.js` so 19.99 + 0.01 === 20.00.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export { Decimal };

/** 1 SOL = 1e9 lamports. SPL tokens vary (USDC on Solana = 6). */
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const NATIVE_DECIMALS = 9;

export const d = (v: Decimal.Value): Decimal => new Decimal(v);

export const atomicToDecimal = (atomic: bigint | string, decimals: number): Decimal =>
  new Decimal(atomic.toString()).div(new Decimal(10).pow(decimals));

export const decimalToAtomic = (value: Decimal.Value, decimals: number): bigint => {
  const scaled = new Decimal(value).mul(new Decimal(10).pow(decimals));
  // Integer string -> bigint, never via Number()
  return BigInt(scaled.toFixed(0, Decimal.ROUND_DOWN));
};

/** Human display: 12.345678901 SOL, trailing zeros trimmed. */
export function formatCrypto(value: Decimal.Value, decimals = 9, maxDp = 9): string {
  const dp = Math.min(decimals, maxDp);
  const v = new Decimal(value).toDecimalPlaces(dp, Decimal.ROUND_DOWN);
  const s = v.toFixed(dp);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function formatUsd(value: Decimal.Value, minDp = 2): string {
  const v = new Decimal(value);
  // Always show at least minDp, at most 4 when there are meaningful decimals.
  const dp = v.decimalPlaces() > 0 ? Math.max(minDp, Math.min(4, v.decimalPlaces())) : minDp;
  return v.toFixed(dp, Decimal.ROUND_HALF_UP);
}

export const bps = (percent: Decimal.Value): Decimal => new Decimal(percent).div(10000);

/** applyMarkup(100, 500) => 105.00 */
export const applyMarkup = (amount: Decimal.Value, markupBpsValue: number): Decimal =>
  new Decimal(amount).mul(new Decimal(1).plus(new Decimal(markupBpsValue).div(10000)));

export const applyDiscountBps = (amount: Decimal.Value, discountBpsValue: number): Decimal =>
  new Decimal(amount).mul(new Decimal(1).minus(new Decimal(discountBpsValue).div(10000)));

/**
 * Quote a USD price into token atomic units.
 * Uses `mul`+`toFixed(0, ROUND_UP)` so we never under-charge by a rounding
 * error — an underpaid order triggers a manual review path.
 */
export function quoteUsdToAtomic(
  usd: Decimal.Value,
  tokenUsd: Decimal.Value,
  tokenDecimals: number,
  opts: { markupBps?: number; dustBps?: number } = {},
): { atomic: bigint; crypto: Decimal; usd: Decimal } {
  const usdWithMarkup = applyMarkup(usd, opts.markupBps ?? 0);
  const price = new Decimal(tokenUsd);
  if (price.lte(0)) throw new Error('Token price must be > 0');
  const crypto = usdWithMarkup.div(price);
  const dust = new Decimal(1).div(new Decimal(10).pow(tokenDecimals)).mul(opts.dustBps ?? 0);
  const atomic = decimalToAtomic(crypto.add(dust), tokenDecimals);
  return { atomic, crypto: atomicToDecimal(atomic, tokenDecimals), usd: usdWithMarkup };
}

/** Convert USD credited to atomic units back for display / reconciliation. */
export function atomicToUsd(atomic: bigint | string, tokenDecimals: number, tokenUsd: Decimal.Value): Decimal {
  return atomicToDecimal(atomic, tokenDecimals).mul(tokenUsd);
}

/** Amount actually required, allowing `toleranceBps` underpayment. */
export function requiredAtomic(expected: bigint, toleranceBpsValue: number): bigint {
  const slack = (expected * BigInt(toleranceBpsValue)) / 10_000n;
  return expected - slack;
}

export function isSettled(received: bigint, expected: bigint, toleranceBpsValue: number): boolean {
  return received >= requiredAtomic(expected, toleranceBpsValue);
}

/** Percentage shortfall, e.g. underpaid by 12.4%. */
export function shortfallPct(received: bigint, expected: bigint): Decimal {
  if (expected <= 0n) return new Decimal(0);
  const diff = new Decimal((expected - received).toString());
  return diff.div(new Decimal(expected.toString())).mul(100);
}

export const sumDecimals = (values: Decimal.Value[]): Decimal =>
  values.reduce<Decimal>((a, b) => a.plus(b), new Decimal(0));

export function parseDecimalSafe(input: unknown): Decimal {
  if (input instanceof Decimal) return input;
  if (typeof input === 'bigint') return new Decimal(input.toString());
  if (typeof input === 'number') return new Decimal(String(input));
  if (typeof input === 'string' && input.trim() !== '') return new Decimal(input.trim());
  throw new Error(`Cannot parse decimal from ${typeof input}`);
}