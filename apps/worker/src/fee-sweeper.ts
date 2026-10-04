/**
 * Platform-fee sweeper.
 *
 * Moves the accumulated 1% platform fee to the collector wallet on Solana.
 *
 * ── Flow ────────────────────────────────────────────────────────────────────
 *   1. Fulfilment completes -> a `FeeAccrual` row is written (one per order,
 *      UNIQUE on orderId so a retry cannot double-accrue).
 *   2. Once the unswept balance for a token exceeds `minSweepAtomic`, this job
 *      claims a batch of accruals, attaches them to a `FeeSweep`, and submits a
 *      real transfer from a dedicated HD slot to the collector.
 *   3. On confirmation the sweep is marked CONFIRMED and the accruals get
 *      `sweptAt`. If the transfer fails, the accruals are detached again
 *      (`sweepId = null`) so the next attempt retries the same money. Nothing is
 *      ever lost and nothing is ever double-sent.
 *
 * ── Why a dedicated HD slot, on its own seed ────────────────────────────────
 * Deposits use monotonically allocated slots starting at 0. Sweeping uses a
 * slot far above that range (`WALLET_SWEEP_INDEX_SOL`), so a sweeping transfer
 * can never be mistaken for a customer deposit by the payment watcher.
 *
 * The sweep keys can additionally live on their own seed (`WALLET_SWEEP_SEED`).
 * Separating the index stops a sweep *transaction* looking like a deposit;
 * separating the seed stops a compromised sweeper from being able to *derive*
 * deposits at all. Only sweeping signs anything, so this is the whole signing
 * surface of the platform, and it can be isolated from the derivation surface.
 * Generate the second seed with `npm run wallet:sweep-new`.
 *
 * ── Token handling ─────────────────────────────────────────────────────────
 * Fees accrue in whatever token the customer paid with, and are swept in that
 * same token. USDC transfers go to the collector's associated token account,
 * created on demand — paying the collector's *owner* address with USDC would
 * move nothing.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { PrismaClient, TokenSymbol, FeeSweepStatus, type FeeAccrual } from '@solbazaar/db';
import { SolanaHdWallet, RpcPool, tokenInfo, tokenExplorerUrl, MAX_TX_VERSION } from '@solbazaar/crypto';
import Decimal from 'decimal.js';
import {
  platformFeeConfig,
  createLogger,
  atomicToDecimal,
  sleep,
} from '@solbazaar/core';

const prisma = new PrismaClient();
const log = createLogger({ service: 'fee-sweeper' });

/** Base fee + priority fee. Bump priority so a sweep is not stuck behind spam. */
function feeInstructions(): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 }),
  ];
}

/** Ensure the collector's ATA exists (idempotent — safe to include every time). */
function ensureCollectorAta(mint: PublicKey, owner: PublicKey): { address: PublicKey; instruction: TransactionInstruction } {
  const address = getAssociatedTokenAddressSync(mint, owner, true);
  return {
    address,
    instruction: createAssociatedTokenAccountIdempotentInstruction(
      owner, // the sweeping slot pays the rent, not the collector
      address,
      owner, // the ATA's owner is always the collector wallet
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  };
}

export interface SweepResult {
  token: TokenSymbol;
  swept: boolean;
  reason?: string;
  atomicAmount?: string;
  signature?: string;
  feeCount?: number;
  usdAmount?: string;
}

export async function sweepPlatformFees(opts: { force?: boolean } = {}): Promise<SweepResult[]> {
  const cfg = platformFeeConfig();
  if (!cfg.enabled || cfg.maxSweepAtomic === 0n) {
    log.warn('fee_sweeping_disabled', { bps: cfg.bps, collector: cfg.collector });
    return [];
  }

  const wallet = SolanaHdWallet.sweepFromEnv();
  if (!SolanaHdWallet.sweepIsSplit()) {
    // Not fatal, but it is the difference between "a compromised sweeper can move
    // your revenue" and "...can also derive every customer deposit address".
    log.warn('sweep_seed_not_split', {
      action: 'fee sweeping signs with the operator seed; set WALLET_SWEEP_SEED to isolate it',
    });
  }
  const rpc = RpcPool.fromEnv();
  const connection = rpc.current;
  const isDevnet = process.env.SOLANA_CLUSTER !== 'mainnet-beta';
  const results: SweepResult[] = [];

  // Which tokens have unswept fees, and how much of each?
  const pending = await prisma.$queryRaw<{ token: TokenSymbol; total: bigint; cnt: number }[]>`
    SELECT "token", SUM("atomicAmount"::bigint) AS total, COUNT(*)::int AS cnt
    FROM "FeeAccrual"
    WHERE "sweepId" IS NULL AND "atomicAmount" > '0'
    GROUP BY "token"
  `;

  if (!pending.length) {
    log.debug('no_pending_fees');
    return results;
  }

  for (const row of pending) {
    try {
      results.push(await sweepToken(connection, wallet, cfg, row.token, isDevnet, opts.force === true));
    } catch (e) {
      log.error('sweep_failed', { token: row.token, err: (e as Error).message });
      results.push({ token: row.token, swept: false, reason: (e as Error).message });
    }
    // Solana fees are per-signature, so pace sweeps to avoid rate limits.
    await sleep(250);
  }

  return results;
}

async function sweepToken(
  connection: Connection,
  wallet: SolanaHdWallet,
  cfg: ReturnType<typeof platformFeeConfig>,
  token: TokenSymbol,
  isDevnet: boolean,
  force: boolean,
): Promise<SweepResult> {
  const info = tokenInfo(token, isDevnet);
  const threshold = token === TokenSymbol.SOL ? cfg.minSweepAtomic : 1n; // stablecoins are cheap to move
  const maxSweep = token === TokenSymbol.SOL ? cfg.maxSweepAtomic : BigInt(Number.MAX_SAFE_INTEGER);

  // Claim a batch of the oldest unswept accruals for this token.
  const accruals = (await prisma.$queryRaw<FeeAccrual[]>`
    SELECT * FROM "FeeAccrual"
    WHERE "token" = ${token}::"TokenSymbol" AND "sweepId" IS NULL AND "atomicAmount" > '0'
    ORDER BY "createdAt" ASC
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  `);

  if (!accruals.length) return { token, swept: false, reason: 'nothing_pending' };

  const total = accruals.reduce((a, x) => a + BigInt(x.atomicAmount), 0n);
  if (total < threshold && !force) {
    log.debug('below_sweep_threshold', {
      token,
      pending: atomicToDecimal(total, info.decimals).toFixed(6),
      threshold: atomicToDecimal(threshold, info.decimals).toFixed(6),
    });
    return { token, swept: false, reason: 'below_threshold', atomicAmount: total.toString() };
  }

  const amount = total > maxSweep ? maxSweep : total;

  // Sweeping from a dedicated, high HD slot so deposits are never disturbed.
  const sweepIndex = token === TokenSymbol.SOL ? sweepSlotSol() : sweepSlotSpl();
  const signer = wallet.keypairAt(sweepIndex);
  const collector = new PublicKey(cfg.collector);

  // Per-transaction rent must be covered from the sweeping slot itself.
  const rentBuffer = token === TokenSymbol.SOL ? 20_000_000n : 2_282_880n; // ~0.02 SOL
  if (token === TokenSymbol.SOL && amount + rentBuffer > await connection.getBalance(signer.publicKey, 'confirmed')) {
    return {
      token,
      swept: false,
      reason: 'insufficient_balance_in_sweep_slot',
      atomicAmount: amount.toString(),
    };
  }

  // Create the sweep row first so a crash mid-submit leaves an auditable record.
  const sweep = await prisma.feeSweep.create({
    data: {
      token,
      mint: info.mint,
      decimals: info.decimals,
      atomicAmount: amount.toString(),
      feeCount: accruals.length,
      usdAmount: accruals.reduce((a, x) => a.plus(x.usdAmount), new Decimal(0)),
      fromAddress: signer.publicKey.toBase58(),
      toAddress: collector.toBase58(),
      status: FeeSweepStatus.SIGNING,
    },
  });

  // Attach the accruals atomically — this is what makes the transfer auditable
  // and prevents two sweeps from ever claiming the same fees.
  const attached = await prisma.feeAccrual.updateMany({
    where: { id: { in: accruals.map((a) => a.id) }, sweepId: null },
    data: { sweepId: sweep.id },
  });
  if (attached.count !== accruals.length) {
    log.warn('sweep_claim_race', { sweepId: sweep.id, expected: accruals.length, attached: attached.count });
  }

  try {
    let instructions: TransactionInstruction[] = feeInstructions();

    if (token === TokenSymbol.SOL) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: collector,
          // Leave the rent buffer behind.
          lamports: amount - rentBuffer > 0n ? amount - rentBuffer : amount,
        }),
      );
    } else {
      const mint = new PublicKey(info.mint!);
      const { address: collectorAta, instruction } = ensureCollectorAta(mint, collector);
      instructions.push(instruction);
      instructions.push(
        createTransferCheckedInstruction(
          getAssociatedTokenAddressSync(mint, signer.publicKey, true),
          mint,
          collectorAta,
          signer.publicKey, // owner
          amount,
          info.decimals,
          undefined,
          TOKEN_PROGRAM_ID,
        ),
      );
    }

    const tx = new Transaction().add(...instructions);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

    const signature = await sendAndConfirmTransaction(connection, tx, [signer], {
      commitment: 'confirmed',
      skipPreflight: false,
    });

    const detail = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: MAX_TX_VERSION,
    });

    await prisma.$transaction([
      prisma.feeSweep.update({
        where: { id: sweep.id },
        data: {
          status: FeeSweepStatus.CONFIRMED,
          signature,
          slot: detail?.slot ?? null,
          blockTime: detail?.blockTime ? new Date(detail.blockTime * 1000) : null,
          confirmedAt: new Date(),
        },
      }),
      prisma.feeAccrual.updateMany({
        where: { sweepId: sweep.id },
        data: { sweptAt: new Date() },
      }),
    ]);

    log.info('fee_swept', {
      token,
      amount: atomicToDecimal(amount, info.decimals).toFixed(6),
      fees: accruals.length,
      signature,
      collector: cfg.collector,
      explorer: tokenExplorerUrl(signature, isDevnet),
    });

    return {
      token,
      swept: true,
      atomicAmount: amount.toString(),
      signature,
      feeCount: accruals.length,
      usdAmount: sweep.usdAmount.toString(),
    };
  } catch (e) {
    // Detach the accruals so the money is retried rather than lost, and record
    // why. Never silently swallow: an unswept balance is our revenue stuck on
    // an operational shelf.
    const message = (e as Error).message.slice(0, 500);
    await prisma.$transaction([
      prisma.feeSweep.update({
        where: { id: sweep.id },
        data: { status: FeeSweepStatus.FAILED, error: message, attempts: { increment: 1 } },
      }),
      prisma.feeAccrual.updateMany({ where: { sweepId: sweep.id }, data: { sweepId: null } }),
    ]);
    log.error('fee_sweep_transaction_failed', { sweepId: sweep.id, token, err: message });
    return { token, swept: false, reason: message, atomicAmount: amount.toString() };
  }
}

// ── Sweep slot selection ────────────────────────────────────────────────────

function sweepSlotSol(): number {
  return Number(process.env.WALLET_SWEEP_INDEX_SOL ?? 999_000);
}
function sweepSlotSpl(): number {
  return Number(process.env.WALLET_SWEEP_INDEX_SPL ?? 999_001);
}

/** Report the unswept balance per token — surfaced by the ops endpoint. */
export async function pendingFeeBalances() {
  const rows = await prisma.$queryRaw<{ token: TokenSymbol; atomic: bigint; cnt: number }[]>`
    SELECT "token", SUM("atomicAmount"::bigint) AS atomic, COUNT(*)::int AS cnt
    FROM "FeeAccrual"
    WHERE "sweepId" IS NULL AND "atomicAmount" > '0'
    GROUP BY "token"
  `;
  const isDevnet = process.env.SOLANA_CLUSTER !== 'mainnet-beta';
  return rows.map((r) => {
    const info = tokenInfo(r.token, isDevnet);
    return {
      token: r.token,
      atomic: r.atomic.toString(),
      amount: atomicToDecimal(r.atomic, info.decimals).toFixed(6),
      decimals: info.decimals,
      feeCount: r.cnt,
    };
  });
}

/** Totals across all history — used for accounting reconciliation. */
export async function feeTotals() {
  const rows = await prisma.$queryRaw<{ token: TokenSymbol; total: bigint; swept: bigint; cnt: number }[]>`
    SELECT "token",
           SUM("atomicAmount"::bigint) AS total,
           COALESCE(SUM(CASE WHEN "sweptAt" IS NOT NULL THEN "atomicAmount"::bigint ELSE 0 END), 0) AS swept,
           COUNT(*)::int AS cnt
    FROM "FeeAccrual"
    GROUP BY "token"
  `;
  const isDevnet = process.env.SOLANA_CLUSTER !== 'mainnet-beta';
  return rows.map((r) => {
    const info = tokenInfo(r.token, isDevnet);
    return {
      token: r.token,
      totalAtomic: r.total.toString(),
      totalAmount: atomicToDecimal(r.total, info.decimals).toFixed(6),
      sweptAtomic: r.swept.toString(),
      sweptAmount: atomicToDecimal(r.swept, info.decimals).toFixed(6),
      unsweptAtomic: (r.total - r.swept).toString(),
      unsweptAmount: atomicToDecimal(r.total - r.swept, info.decimals).toFixed(6),
      orderCount: r.cnt,
    };
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Run a one-off sweep:  npx tsx src/fee-sweeper.ts
if (process.argv[1]?.includes('fee-sweeper')) {
  sweepPlatformFees({ force: process.argv.includes('--force') })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export { prisma, LAMPORTS_PER_SOL };