/**
 * HD wallet for Solana: one unique deposit address per order.
 *
 * ── Why HD derivation ────────────────────────────────────────────────────────
 * Every order gets its *own* on-chain address (m/44'/501'/{index}'/0'). That
 * gives us automatic reconciliation: an incoming transaction is unambiguously
 * attributable to exactly one order, with no memo field and no amount-hashing
 * heuristics. We never reuse an address across orders, so there is nothing to
 * confuse a customer or an attacker.
 *
 * ── What is stored ───────────────────────────────────────────────────────────
 * The 32-byte BIP39 seed, AES-256-GCM encrypted at rest with a key derived from
 * WALLET_MASTER_KEY (scrypt). The DB stores only the ciphertext. Losing
 * WALLET_MASTER_KEY means losing every unreconciled deposit — treat it with the
 * same care as a hardware wallet seed phrase, and keep backups offline.
 *
 * ── Derivation path ──────────────────────────────────────────────────────────
 * Solana follows SLIP-0044 (coin type 501) with ed25519 SLIP-0010 hardened
 * derivation. `{index}` is hardened so child keys cannot be derived from a
 * parent public key alone (non-hardened ed25519 is not safe).
 *
 *   m / 44'  / 501' / {index}' / 0'
 *     |       |        |        └─ change (always 0; we never need public x-only chaining)
 *     |       |        └────────── account index = the order's deposit slot
 *     |       └─────────────────── Solana
 *     └─────────────────────────── purpose (BIP-44)
 *
 * Because ed25519 SLIP-0010 cannot produce a public key from a parent public key
 * without the private scalar, hardened indices are mandatory here.
 *
 * ── Non-custodial variant ────────────────────────────────────────────────────
 * Set `DEPOSIT_MODE=custodial` for the default sweep behaviour, or
 * `DEPOSIT_MODE=external` + DEPOSIT_ADDRESS_PREFIX when you run a separate
 * watcher service that does not hold the seed (see index.ts for the interface).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import * as bip39 from 'bip39';
import bs58 from 'bs58';
import { createLogger, chainError } from '@solbazaar/core';

const log = createLogger({ service: 'wallet' });

export const SOLANA_COIN_TYPE = 501;
export const PATH_PURPOSE = 44;

/**
 * Default hardened-path template. `{index}` is replaced by the slot number.
 * Template literal (backticks) so the coin type is interpolated at load.
 */
export const DEFAULT_PATH_TEMPLATE = `m/${PATH_PURPOSE}'/${SOLANA_COIN_TYPE}'/{index}'/0'`;

export interface WalletConfig {
  /** BIP39 mnemonic or hex seed. Generated and persisted if absent. */
  seed: string;
  pathTemplate?: string;
  /** Highest slot to hand out; refuses to derive beyond it (key-sweep guard). */
  maxIndex?: number;
}

export interface DerivedAccount {
  index: number;
  path: string;
  publicKey: string;
  /** base58 of the 32-byte public key — the address we show customers */
  address: string;
}

// ---------------------------------------------------------------------------
// AES-256-GCM envelope encryption for the seed at rest
// ---------------------------------------------------------------------------

const ENC_VERSION = 'v1';

export function deriveMasterKey(masterKey: string, salt: string): Buffer {
  // N=2^15 keeps derivation ~80ms, acceptable once per process at boot.
  return scryptSync(masterKey.normalize('NFKD'), salt, 32, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function encryptSeed(seed: string, masterKey: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveMasterKey(masterKey, salt.toString('base64'));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, salt.toString('base64'), iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSeed(blob: string, masterKey: string): string {
  const [v, saltB64, ivB64, tagB64, dataB64] = blob.split('.');
  if (v !== ENC_VERSION) throw chainError(`Unknown seed envelope version: ${v}`);
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const key = deriveMasterKey(masterKey, salt.toString('base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

export function normaliseSeed(input: string): { seedHex: string; mnemonic: string | null } {
  const trimmed = input.trim();

  // An AES-GCM envelope (v1.salt.iv.tag.ciphertext) is what we store in the
  // environment. Decrypt it with WALLET_MASTER_KEY before anything else.
  if (trimmed.startsWith(ENC_VERSION + '.')) {
    const master = process.env.WALLET_MASTER_KEY;
    if (!master) {
      throw chainError('WALLET_SEED is encrypted but WALLET_MASTER_KEY is not set');
    }
    return normaliseSeed(decryptSeed(trimmed, master).trim()); // recurse on plaintext
  }

  // hex seed (64 chars) — output of some keygen tools
  if (/^[0-9a-fA-F]{64}$/.test(trimmed) && !bip39.validateMnemonic(trimmed)) {
    return { seedHex: trimmed.toLowerCase(), mnemonic: null };
  }
  if (bip39.validateMnemonic(trimmed)) {
    return { seedHex: bip39.mnemonicToSeedSync(trimmed).toString('hex'), mnemonic: trimmed };
  }
  throw chainError('WALLET_SEED is neither an encrypted envelope, a valid BIP39 mnemonic, nor a 64-char hex seed');
}

export function generateMnemonic(strengthBits: 128 | 256 = 256): string {
  return bip39.generateMnemonic(strengthBits);
}

// ---------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------

export class SolanaHdWallet {
  private readonly seedHex: string;
  private readonly template: string;
  readonly maxIndex: number;
  /** Memoised keypairs: derivation is ~1ms, and the watcher re-derives often. */
  private cache = new Map<number, Keypair>();

  constructor(cfg: WalletConfig) {
    const { seedHex } = normaliseSeed(cfg.seed);
    this.seedHex = seedHex;
    this.template = cfg.pathTemplate ?? DEFAULT_PATH_TEMPLATE;
    this.maxIndex = cfg.maxIndex ?? Number(process.env.WALLET_MAX_INDEX ?? 1_000_000);
  }

  static fromEnv(env = process.env): SolanaHdWallet {
    const seed = env.WALLET_SEED;
    if (!seed) {
      throw chainError(
        'WALLET_SEED is not set. Generate one with: npm run wallet:new  (see docs/OPERATIONS.md)',
      );
    }
    return new SolanaHdWallet({ seed });
  }

  pathFor(index: number): string {
    if (!Number.isInteger(index) || index < 0) throw chainError(`Invalid derivation index: ${index}`);
    if (index > this.maxIndex) {
      throw chainError(`Derivation index ${index} exceeds WALLET_MAX_INDEX=${this.maxIndex}. Refusing to derive.`);
    }
    return this.template.replace('{index}', String(index));
  }

  keypairAt(index: number): Keypair {
    const hit = this.cache.get(index);
    if (hit) return hit;

    const path = this.pathFor(index);
    // derivePath implements SLIP-0010 ed25519 hardened derivation and returns
    // 64 bytes: key(32) || chainCode(32). Solana only uses the first 32 as seed.
    const derived = derivePath(path, this.seedHex);
    if (!derived?.key || derived.key.length !== 32) {
      throw chainError(`HD derivation failed for path ${path}`);
    }
    let kp: Keypair;
    try {
      kp = Keypair.fromSeed(derived.key);
    } catch (e) {
      // Astronomically unlikely (1 in 2^128); surface it loudly if it happens.
      log.error('invalid_derived_seed', { path, err: e });
      throw chainError(`Derived an invalid ed25519 seed at ${path}`);
    }

    if (this.cache.size < 10_000) this.cache.set(index, kp);
    return kp;
  }

  accountAt(index: number): DerivedAccount {
    const path = this.pathFor(index);
    const kp = this.keypairAt(index);
    return {
      index,
      path,
      publicKey: kp.publicKey.toBase58(),
      address: kp.publicKey.toBase58(),
    };
  }

  /**
   * Allocate the next unused slot. The caller MUST persist `index` inside the
   * same transaction that creates the order, otherwise two orders can collide.
   */
  nextIndex(used: ReadonlySet<number>): number {
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }

  /** Sweep — move funds from a deposit slot into the hot wallet. */
  sweepSlot(index: number, to: PublicKey): { path: string; from: string } {
    return { path: this.pathFor(index), from: this.keypairAt(index).publicKey.toBase58() };
    // (signing is intentionally left to the caller; see docs/OPERATIONS.md)
  }

  /**
   * The wallet that signs fee sweeps.
   *
   * ── Why this can be a different seed ─────────────────────────────────────────
   * Fee sweeping is the only part of the system that *spends* from the operator
   * seed, and it is also the part most exposed: it signs transactions, runs on a
   * timer, and sends to a collector address held in config. Deposit derivation
   * never signs anything — it only produces addresses for customers to pay.
   *
   * Splitting the two means compromising the sweeper (a bad dependency, a leaked
   * config, a compromised host) yields an attacker who can move *your revenue*
   * but who cannot derive a single customer deposit address — so unreconciled
   * inbound payments stay exactly where they are.
   *
   * ── Fallback ────────────────────────────────────────────────────────────────
   * With no `WALLET_SWEEP_SEED`, this returns the operator wallet, so existing
   * deployments keep working unchanged and the split only takes effect once a
   * second seed is configured. Deliberately not a hard failure: refusing to boot
   * because an optional hardening step is absent is worse than the risk it
   * removes.
   */
  static sweepFromEnv(env = process.env): SolanaHdWallet {
    const seed = env.WALLET_SWEEP_SEED?.trim();
    if (!seed) return SolanaHdWallet.fromEnv(env);
    return new SolanaHdWallet({ seed });
  }

  /** True when sweeping signs with its own seed rather than the operator's. */
  static sweepIsSplit(env = process.env): boolean {
    return Boolean(env.WALLET_SWEEP_SEED?.trim());
  }

  isValidAddress(addr: string): boolean {
    try {
      const k = new PublicKey(addr);
      return PublicKey.isOnCurve(k.toBytes());
    } catch {
      return false;
    }
  }

  addressToBytes(addr: string): Uint8Array {
    return new PublicKey(addr).toBytes();
  }

  bytesToAddress(b: Uint8Array): string {
    return new PublicKey(b).toBase58();
  }

  get address0(): string {
    return this.accountAt(0).address;
  }
}

/** Constant-time string compare for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export { bs58 };

/**
 * Generate a fresh operator wallet and print the encrypted envelope.
 * Run with: `npx tsx scripts/wallet-new.ts`
 */
export function bootstrapWallet(masterKey: string, strength: 128 | 256 = 256) {
  const mnemonic = generateMnemonic(strength);
  const envelope = encryptSeed(mnemonic, masterKey);
  const wallet = new SolanaHdWallet({ seed: mnemonic });
  return { mnemonic, envelope, operatorAddress: wallet.accountAt(0).address };
}