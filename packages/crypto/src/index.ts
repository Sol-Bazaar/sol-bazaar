export * from './types';
export * from './connection';
export * from './tokens';
export * from './hd-wallet';
export * from './verify';

import { Connection, PublicKey } from '@solana/web3.js';
import { TokenBucket } from '@solbazaar/core';
import type { RpcConfig } from './connection';
import { rpcConfigFromEnv } from './connection';

/**
 * Failover RPC pool.
 *
 * Round-robins healthy endpoints and retries once on a different node when a
 * request fails, so a rate-limited or flapping public endpoint does not stall
 * the watcher (which would delay every customer's gift card).
 */
export class RpcPool {
  private idx = 0;
  private failures = new Map<string, number>();
  private bucket = new TokenBucket(40, 60);

  readonly config: RpcConfig;

  constructor(config: RpcConfig) {
    this.config = config;
    if (!config.urls?.length) throw new Error('RpcPool requires at least one RPC URL');
  }

  static fromEnv(env = process.env): RpcPool {
    return new RpcPool(rpcConfigFromEnv(env));
  }

  get current(): Connection {
    const url = this.config.urls[this.idx % this.config.urls.length];
    return new Connection(url, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: this.config.timeoutMs,
      wsEndpoint: this.config.wsUrl,
      disableRetryOnRateLimit: true,
    });
  }

  /** Rotate to the next endpoint and return a fresh Connection. */
  next(): Connection {
    this.idx++;
    return this.current;
  }

  markFailure(url: string) {
    this.failures.set(url, (this.failures.get(url) ?? 0) + 1);
  }

  markSuccess(url: string) {
    this.failures.delete(url);
  }

  /** Rate-limit ourselves so we stay under provider quotas proactively. */
  async throttle(): Promise<void> {
    const wait = this.bucket.msUntil(1);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.bucket.tryRemove(1);
  }

  get activeUrl(): string {
    return this.config.urls[this.idx % this.config.urls.length];
  }
}

export { Connection, PublicKey };