/**
 * On-chain deposit verification.
 *
 * ── How attribution works ───────────────────────────────────────────────────
 * Every order has a unique deposit address, so attribution is exact: scan that
 * address's signature history and any transaction crediting it belongs to that
 * order. No memo parsing, no amount matching, no heuristics.
 *
 * ── SPL requires watching the ATA, not the owner ────────────────────────────
 * When a customer sends USDC to an address, the token program actually moves
 * value into that address's Associated Token Account (a separate account). A
 * naive `getSignaturesForAddress(depositAddress)` misses those transfers
 * entirely and strands funds. So SPL orders additionally watch the ATA derived
 * from (mint, depositAddress), and read the credit from the ATA's token balance
 * delta.
 *
 * ── Balance deltas, not instructions ─────────────────────────────────────────
 * We compare pre/post balances for the account's *index* in the account key
 * list rather than pattern-matching instructions. That is robust across every
 * transfer shape: `transfer`, `transferChecked`, CPI from another program,
 * memo-carrying transfers, and wrapped/SOL-wrapped SPL.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 * `PaymentTx.signature` is UNIQUE in Postgres, so a re-scan (watcher restart,
 * two workers racing, RPC returning the same sig twice) can never double-credit.
 */
import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
  type VersionedTransactionResponse,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { TokenBucket, createLogger, chainError } from '@solbazaar/core';
import { MIN_CONFIRMATIONS, REQUIRE_FINALIZED, MAX_TX_VERSION } from './connection';
import { tokenInfo, type TokenSymbol } from './tokens';
import type { TokenInfo } from './types';

const log = createLogger({ service: 'chain-verify' });

/** Either a legacy (JSON-parsed) or a versioned transaction response. */
export type AnyTx = ParsedTransactionWithMeta | VersionedTransactionResponse;

export interface DepositScanTarget {
  orderId: string;
  /** Owner address derived from the HD wallet (watches SOL). */
  ownerAddress: string;
  /** ATA of the token mint, when paying with SPL. */
  ataAddress: string | null;
  token: TokenInfo;
  /** Atomic units already recorded in the DB, so we only report new credits. */
  alreadyRecorded: Set<string>;
}

export interface ObservedCredit {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** Positive atomic units credited to the deposit account. */
  atomicAmount: bigint;
  /** Negative when funds left the deposit address (sweep / refund). */
  direction: 'IN' | 'OUT';
  confirmations: number;
  finalized: boolean;
  feePayer?: string;
  raw?: unknown;
}

export interface ScanOptions {
  limit?: number;
  /** Require at least this many confirmations before crediting. */
  minConfirmations?: number;
  requireFinalized?: boolean;
  currentSlot?: number;
}

interface ParsedAmounts {
  lamports: bigint;
  tokenAmount: bigint;
}

/** Normalise legacy + versioned transactions into `{key, signer, writable}`. */
/** Normalise a base58 string into a PublicKey, or undefined if unusable. */
function toKey(k: any): PublicKey | undefined {
  try {
    if (k instanceof PublicKey) return k;
    if (typeof k === 'string') return new PublicKey(k);
    if (k && typeof k.pubkey !== 'undefined') return k.pubkey instanceof PublicKey ? k.pubkey : new PublicKey(k.pubkey);
  } catch {
    /* malformed key */
  }
  return undefined;
}

export function accountKeysOf(tx: AnyTx): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const msg = messageOf(tx);
  const meta: any = (tx as any).meta;

  if (typeof msg.getAccountKeys === 'function') {
    // VersionedTransaction. `meta.loadedAddresses` arrives from JSON-RPC as
    // base58 strings, so coerce before handing it to web3.js.
    const la = meta?.loadedAddresses ?? {};
    const lookups = {
      writable: (la.writable ?? []).map(toKey).filter(Boolean),
      readonly: (la.readonly ?? []).map(toKey).filter(Boolean),
    } as { writable: PublicKey[]; readonly: PublicKey[] };

    const keys = msg.getAccountKeys({ accountKeysFromLookups: lookups });
    return (keys?.accounts ?? [])
      .map((k: any) => ({ pubkey: toKey(k)!, isSigner: !!k.signer, isWritable: !!k.writable }))
      .filter((k: { pubkey: PublicKey }) => !!k.pubkey);
  }

  if (Array.isArray(msg.accountKeys)) {
    return msg.accountKeys
      .map((k: any) =>
        typeof k === 'string' || (k && k.pubkey)
          ? { pubkey: toKey(k)!, isSigner: !!k?.signer, isWritable: !!k?.writable }
          : null,
      )
      .filter((k: any): k is { pubkey: PublicKey; isSigner: boolean; isWritable: boolean } => !!k && !!k.pubkey);
  }

  return [];
}

/**
 * Unwrap either a full RPC response (`{ slot, transaction, meta }`) or a bare
 * transaction (`{ message, signatures }`) down to the message.
 *
 * Being shape-tolerant matters more than it looks: if a caller passes the wrong
 * shape we would otherwise silently read `undefined` and report a zero delta,
 * which in production means "no payment detected" — funds stranded rather than
 * an error. So this throws instead.
 */
function messageOf(tx: AnyTx): any {
  const msg = (tx as any)?.transaction?.message ?? (tx as any)?.message;
  if (!msg) throw chainError('Unsupported transaction shape: no message found');
  return msg;
}

/**
 * The static account keys of the message (legacy and versioned).
 *
 * Kept for callers that need the message's own key list — for example to decide
 * whether an address is a lookup-table entry. For indexing `preBalances` and
 * friends use `balanceIndexSpaceOf`, which is a superset.
 */
export function staticAccountKeysOf(tx: AnyTx): PublicKey[] {
  const msg = messageOf(tx);
  if (Array.isArray(msg.staticAccountKeys)) return msg.staticAccountKeys as PublicKey[]; // v0 / v1
  if (Array.isArray(msg.accountKeys)) {
    // Legacy message: accountKeys holds only the static keys.
    return msg.accountKeys.map(toKey).filter(Boolean) as PublicKey[];
  }
  throw chainError('Unsupported transaction shape: no static account keys');
}

/**
 * Compute the balance movement of a single account in a single transaction.
 *
 * Native SOL comes from `preBalances`/`postBalances`. SPL comes from
 * `preTokenBalances`/`postTokenBalances`, which are sparse arrays keyed by the
 * same account index space.
 */
/**
 * The account index space that `preBalances` / `postBalances` /
 * `preTokenBalances.accountIndex` refer to.
 *
 * Measured against devnet: for a versioned transaction the runtime account array
 * is
 *
 *     staticAccountKeys  ++  loadedAddresses.writable  ++  loadedAddresses.readonly
 *
 * and `preBalances.length` equals that total. Using only the static keys — or
 * only `getAccountKeys()` without the lookup tables — silently reads the wrong
 * account, and in the static-only case reports a zero delta, which means "no
 * payment detected". Modern Solana transactions very often use lookup tables, so
 * this must be exact.
 *
 * `assertIndexSpace` below turns any future divergence into a loud failure
 * rather than a silent zero.
 */
export function balanceIndexSpaceOf(tx: AnyTx): PublicKey[] {
  const msg = messageOf(tx);
  const meta: any = (tx as any).meta;
  const la = meta?.loadedAddresses ?? {};

  const loadedWritable = (la.writable ?? []).map(toKey).filter(Boolean) as PublicKey[];
  const loadedReadonly = (la.readonly ?? []).map(toKey).filter(Boolean) as PublicKey[];

  if (Array.isArray(msg.staticAccountKeys)) {
    return [...(msg.staticAccountKeys as PublicKey[]), ...loadedWritable, ...loadedReadonly];
  }
  // Legacy message: no lookup tables, accountKeys is the whole space.
  return (msg.accountKeys ?? []).map(toKey).filter(Boolean) as PublicKey[];
}

/**
 * Verify the index space matches the balance arrays. Cheap, and it turns a
 * structural change in Solana's RPC format into an error instead of a silent
 * mis-credit.
 */
export function assertIndexSpace(tx: AnyTx): void {
  const meta: any = (tx as any).meta;
  const preLen = meta?.preBalances?.length;
  if (typeof preLen !== 'number') return;
  const space = balanceIndexSpaceOf(tx);
  if (space.length !== preLen) {
    throw chainError(
      `Account index space mismatch: computed ${space.length} but preBalances has ${preLen}. ` +
        'The RPC transaction shape has changed; update balanceIndexSpaceOf().',
    );
  }
}

export function deltasForAccount(tx: AnyTx, address: PublicKey, mint: string | null): ParsedAmounts {
  // Index into the full runtime account space (static ++ lookup-table keys).
  const keys = balanceIndexSpaceOf(tx);
  const idx = keys.findIndex((k) => k.equals(address));
  // Absent from the space entirely: cannot have received value.
  if (idx < 0) return { lamports: 0n, tokenAmount: 0n };

  const meta: any = (tx as any).meta;
  const pre = BigInt(meta?.preBalances?.[idx] ?? 0);
  const post = BigInt(meta?.postBalances?.[idx] ?? 0);

  let tokenAmount = 0n;
  if (mint) {
    const target = new PublicKey(mint);
    const pick = (list: any[] | undefined) =>
      (list ?? []).find((b) => {
        if (b.accountIndex !== idx) return false;
        try {
          return typeof b.mint === 'string' && new PublicKey(b.mint).equals(target);
        } catch {
          return false;
        }
      });
    const pt = pick(meta?.preTokenBalances);
    const qt = pick(meta?.postTokenBalances);
    if (pt || qt) {
      tokenAmount = BigInt(qt?.uiTokenAmount?.amount ?? 0) - BigInt(pt?.uiTokenAmount?.amount ?? 0);
    }
  }

  return { lamports: post - pre, tokenAmount };
}

/** The address that actually receives value for this token. */
export function receiveAddressFor(target: DepositScanTarget): PublicKey {
  // For SPL the value lands in the ATA; for SOL it lands in the owner account.
  if (target.token.mint && target.ataAddress) return new PublicKey(target.ataAddress);
  return new PublicKey(target.ownerAddress);
}

export function awaitAta(mint: string, owner: string, allowOwnerFallback = true): Promise<string> {
  try {
    return getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(owner), true).then((k) => k.toBase58());
  } catch (e) {
    if (allowOwnerFallback) return Promise.resolve(owner);
    return Promise.reject(chainError(`Cannot derive ATA for mint ${mint}: ${(e as Error).message}`));
  }
}

/**
 * Scan a deposit address's recent history and return newly-observed credits.
 * Safe to call repeatedly and concurrently — callers dedupe on `signature`.
 */
export async function scanDeposit(
  connection: Connection,
  target: DepositScanTarget,
  opts: ScanOptions = {},
): Promise<ObservedCredit[]> {
  const limit = opts.limit ?? 1000;
  const minConf = opts.minConfirmations ?? MIN_CONFIRMATIONS[target.token.mint ? 'SPL' : 'SOL'];
  const requireFinalized = opts.requireFinalized ?? REQUIRE_FINALIZED;
  const receive = receiveAddressFor(target);
  const expectedMint = target.token.mint;

  let signatures: ConfirmedSignatureInfo[];
  try {
    signatures = await connection.getSignaturesForAddress(
      receive,
      { limit },
      'confirmed',
    );
  } catch (e) {
    // "Block not available" / pruned history on a fresh RPC — not fatal.
    log.warn('getSignaturesForAddress failed', { address: receive.toBase58(), err: (e as Error).message });
    return [];
  }

  if (!signatures.length) return [];

  // Oldest-first so `minConfirmations` filtering sees the whole picture.
  const ordered = [...signatures].reverse();
  const fresh = ordered.filter((s) => !s.err && !target.alreadyRecorded.has(s.signature));
  if (!fresh.length) return [];

  const results: ObservedCredit[] = [];

  // Small concurrency window — RPC providers rate-limit aggressively.
  const bucket = new TokenBucket(12, 20);
  const batch = fresh.slice(-100); // guard against pathological histories

  for (let i = 0; i < batch.length; i += 8) {
    const chunk = batch.slice(i, i + 8);
    await Promise.all(
      chunk.map(async (sig) => {
        const waitMs = bucket.msUntil(1);
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
        bucket.tryRemove(1);

        try {
          const tx = (await connection.getTransaction(sig.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: MAX_TX_VERSION,
          })) as AnyTx | null;
          if (!tx || tx.meta?.err) return;

          const d = deltasForAccount(tx, receive, expectedMint);
          const atomic = expectedMint ? d.tokenAmount : d.lamports;
          if (atomic === 0n) return;

          const confirmations = opts.currentSlot != null ? Math.max(0, opts.currentSlot - sig.slot + 1) : 0;

          results.push({
            signature: sig.signature,
            slot: sig.slot,
            blockTime: sig.blockTime ?? null,
            atomicAmount: atomic,
            direction: atomic > 0n ? 'IN' : 'OUT',
            confirmations,
            finalized: sig.confirmationStatus === 'finalized',
            feePayer: accountKeysOf(tx)[0]?.pubkey?.toBase58(),
            raw: { preBalances: tx.meta?.preBalances, postBalances: tx.meta?.postBalances },
          });
        } catch (e) {
          log.warn('getTransaction failed', { signature: sig.signature, err: (e as Error).message });
        }
      }),
    );
  }

  if (opts.currentSlot == null) return results;

  return results.filter((r) => r.confirmations >= minConf && (!requireFinalized || r.finalized || r.confirmations > minConf * 3));
}

/** Resolve an order's watch targets, including the SPL ATA when relevant. */
export async function buildScanTarget(args: {
  orderId: string;
  depositAddress: string;
  token: TokenSymbol;
  isDevnet?: boolean;
  recordedSignatures: Iterable<string>;
}): Promise<DepositScanTarget> {
  const info = tokenInfo(args.token, args.isDevnet);
  const ata = info.mint ? await awaitAta(info.mint, args.depositAddress) : null;
  return {
    orderId: args.orderId,
    ownerAddress: args.depositAddress,
    ataAddress: info.mint ? ata : null,
    token: info,
    alreadyRecorded: new Set(args.recordedSignatures),
  };
}

/** One-shot verification for a customer-supplied signature. */
export async function verifySignature(
  connection: Connection,
  signature: string,
  depositAddress: string,
  mint: string | null,
): Promise<{ ok: boolean; atomicAmount: bigint; slot: number; finalized: boolean; reason?: string }> {
  const tx = (await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: MAX_TX_VERSION,
  })) as AnyTx | null;

  if (!tx) return { ok: false, atomicAmount: 0n, slot: 0, finalized: false, reason: 'transaction_not_found' };
  if (tx.meta?.err) return { ok: false, atomicAmount: 0n, slot: tx.slot, finalized: false, reason: 'transaction_failed' };

  const addr = new PublicKey(depositAddress);
  const d = deltasForAccount(tx, addr, mint);
  const atomic = mint ? d.tokenAmount : d.lamports;

  return {
    ok: atomic > 0n,
    atomicAmount: atomic,
    slot: tx.slot,
    finalized: tx.meta?.err == null && (tx as any).slot != null,
  };
}

/** Current slot height, used to compute confirmation depth. */
export async function currentSlot(connection: Connection): Promise<number> {
  return connection.getSlot('confirmed');
}

/** Aggregate lamports across a set of derived deposit slots (sweeper helper). */
export async function totalBalance(connection: Connection, addresses: string[]): Promise<bigint> {
  if (!addresses.length) return 0n;
  const res = await connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)));
  return res.reduce((acc, r) => acc + BigInt(r?.lamports ?? 0), 0n);
}

/** Small helper for confirmations display on the checkout page. */
export function describeConfirmations(slot: number, headSlot: number): {
  confirmations: number;
  label: string;
  percent: number;
} {
  const confirmations = Math.max(0, headSlot - slot + 1);
  const target = MIN_CONFIRMATIONS.SOL;
  return {
    confirmations,
    percent: Math.min(100, Math.round((confirmations / target) * 100)),
    label: confirmations === 0 ? 'Pending' : confirmations === 1 ? '1 confirmation' : `${confirmations} confirmations`,
  };
}

export type { ConfirmedSignatureInfo };