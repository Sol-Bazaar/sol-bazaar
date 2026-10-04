/**
 * Platform fee configuration.
 *
 * The 1% platform fee is deliberately modelled separately from a tenant's
 * `markupBps`:
 *
 *   face value
 *     + tenant markup   -> what the merchant earns (lives inside lineTotalUsd)
 *     + platform fee    -> ours, accounted on its own so it can be swept out
 *
 * Keeping them apart means: a merchant can set any margin they like without
 * touching our revenue, changing our rate never rewrites historical orders
 * (`platformFeeBps` is snapshotted per order), and a refund can return exactly
 * the fee that was charged.
 */
import { createLogger } from './logger';
import { Decimal } from './money';

const log = createLogger({ service: 'fees' });

/** Destination for all accumulated platform fees. */
export const DEFAULT_COLLECTOR_WALLET = 'EKCMKKGehtGp9UtYvAigogmbfBCHsSbMdMWLfsQNY8yZ';

/** 1% = 100 basis points. */
export const DEFAULT_PLATFORM_FEE_BPS = 100;

export interface PlatformFeeConfig {
  /** Basis points of each line's discounted face value. 0 disables the fee. */
  bps: number;
  collector: string;
  /** Sweep once the pending balance for a token exceeds this (base units). */
  minSweepAtomic: bigint;
  /** Never sweep more than this in one transaction (keeps fees low). */
  maxSweepAtomic: bigint;
  enabled: boolean;
}

export function platformFeeConfig(env = process.env): PlatformFeeConfig {
  const bps = Number(env.PLATFORM_FEE_BPS ?? DEFAULT_PLATFORM_FEE_BPS);
  const collector = (env.PLATFORM_FEE_WALLET ?? DEFAULT_COLLECTOR_WALLET).trim();

  if (!isValidSolanaAddress(collector)) {
    // Fail safe: an invalid collector must silently stop fee sweeping rather
    // than burn gas on a transaction that can never land.
    log.error('invalid_platform_fee_wallet', {
      wallet: collector.slice(0, 12),
      action: 'fee sweeping disabled; fees remain accrued and refundable',
    });
    return {
      bps,
      collector,
      minSweepAtomic: BigInt(Number.MAX_SAFE_INTEGER),
      maxSweepAtomic: 0n,
      enabled: false,
    };
  }

  return {
    bps: Number.isFinite(bps) && bps >= 0 ? Math.floor(bps) : DEFAULT_PLATFORM_FEE_BPS,
    collector,
    minSweepAtomic: BigInt(env.PLATFORM_FEE_MIN_SWEEP_SOL ?? 5_000_000_000), // 5 SOL
    maxSweepAtomic: BigInt(env.PLATFORM_FEE_MAX_SWEEP_SOL ?? 250_000_000_000), // 250 SOL
    enabled: bps > 0,
  };
}

/** Apply the platform fee to a line's discounted face value. */
export function platformFeeFor(amountUsd: Decimal.Value, bps: number): Decimal {
  if (bps <= 0) return new Decimal(0);
  return new Decimal(amountUsd).mul(new Decimal(bps).div(10_000));
}

/**
 * Split a total atomic amount into "merchant" and "platform" portions.
 *
 * The fee is computed as `floor` of the exact share and the remainder is
 * assigned to the merchant, so `merchant + fee === total` exactly. Over-collecting
 * by a single base unit per order would otherwise accumulate into dust that
 * never gets swept.
 */
export function splitAtomicFee(
  totalAtomic: bigint,
  feeBps: number,
): { platformFeeAtomic: bigint; merchantAtomic: bigint } {
  if (feeBps <= 0 || totalAtomic <= 0n) return { platformFeeAtomic: 0n, merchantAtomic: totalAtomic };
  const fee = (totalAtomic * BigInt(feeBps)) / 10_000n;
  return { platformFeeAtomic: fee, merchantAtomic: totalAtomic - fee };
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Structural base58 + length check. Full key validity needs a PublicKey. */
export function isValidSolanaAddress(addr: string): boolean {
  return BASE58.test(addr.trim());
}

/** Public, cacheable description of where fees go — useful for transparency. */
export function feeDisclosure(env = process.env) {
  const cfg = platformFeeConfig(env);
  return {
    bps: cfg.bps,
    percent: cfg.bps / 100,
    collector: cfg.collector,
    enabled: cfg.enabled,
  };
}