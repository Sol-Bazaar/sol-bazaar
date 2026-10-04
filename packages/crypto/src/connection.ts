/**
 * Canonical Solana cluster endpoints.
 *
 * Public endpoints are rate-limited hard and are fine for devnet / low volume
 * only. For mainnet with real money, sign up for a dedicated provider:
 *   - Helius      https://api.helius.xyz/v0     (best DX, enhanced tx APIs, webhooks)
 *   - QuickNode   https://<name>.solana-mainnet.quiknode.pro/<token>/
 *   - Triton      https://<cluster>.triton.one   (paid, very reliable)
 *   - Chainstack  https://rpc.mainnet-beta.solana.com
 */
export type Cluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';

export const DEFAULT_RPC: Record<Cluster, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
};

export interface RpcConfig {
  cluster: Cluster;
  urls: string[];
  /** Round-robin + failover across `urls`. */
  apiKey?: string;
  timeoutMs: number;
  /** WebSocket endpoint for `onLogs` subscriptions. */
  wsUrl?: string;
}

export function rpcConfigFromEnv(env = process.env): RpcConfig {
  const cluster = (env.SOLANA_CLUSTER ?? 'devnet') as Cluster;
  const raw = env.SOLANA_RPC_URLS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const urls = raw.length ? raw : [env.SOLANA_RPC_URL ?? DEFAULT_RPC[cluster]];
  return {
    cluster,
    urls,
    apiKey: env.SOLANA_RPC_API_KEY,
    timeoutMs: Number(env.SOLANA_RPC_TIMEOUT_MS ?? 15_000),
    wsUrl: env.SOLANA_WS_URL,
  };
}

export const WS_DEFAULT: Record<Cluster, string> = {
  'mainnet-beta': 'wss://api.mainnet-beta.solana.com',
  devnet: 'wss://api.devnet.solana.com',
  testnet: 'wss://api.testnet.solana.com',
  localnet: 'ws://127.0.0.1:8900',
};

export function isMainnet(cluster: Cluster): boolean {
  return cluster === 'mainnet-beta';
}

/**
 * Confirmations a deposit must reach before we issue a gift card.
 *
 *  - SOL: 32 slots (~13s) is the practical sweet spot.
 *  - SPL: token accounts can be closed/re-created by the ATA program, so require
 *    full finality (`confirmed`/`finalized`) for a larger safety margin.
 *
 * `finalized` is enforced on top of this when REQUIRE_FINALIZED=true.
 */
export const MIN_CONFIRMATIONS: Record<'SOL' | 'SPL', number> = {
  SOL: Number(process.env.SOL_MIN_CONFIRMATIONS ?? 32),
  SPL: Number(process.env.SPL_MIN_CONFIRMATIONS ?? 32),
};

export const REQUIRE_FINALIZED = (process.env.REQUIRE_FINALIZED ?? 'true').toLowerCase() === 'true';

/**
 * Highest transaction version we ask the RPC for.
 *
 * This MUST stay at the highest version the cluster emits. Solana has shipped
 * v0 (address lookup tables) and then v1 transactions; if this is set below the
 * cluster's version, `getTransaction` and `getBlock` fail outright with
 * "Transaction version (N) is not supported" — which silently breaks payment
 * detection on any block containing such a transaction.
 *
 * Bump this when a new transaction version ships.
 */
export const MAX_TX_VERSION = 1;