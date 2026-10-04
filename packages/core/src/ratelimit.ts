/**
 * Fixed-window rate limiter backed by an in-process Map.
 *
 * Suitable for a single node out of the box. For multi-node deployments swap the
 * backing store for Redis (see `RateLimiter` interface — the two implementations
 * are interchangeable, and the API route only talks to this interface).
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** unix ms at which the current window resets */
  resetAt: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  constructor(private readonly maxKeys = 50_000) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining,
      resetAt: bucket.resetAt,
      retryAfterSec,
    };
  }

  /** Drop expired buckets + hard-cap memory so a scan can't OOM the process. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    if (this.buckets.size > this.maxKeys) {
      const overflow = this.buckets.size - this.maxKeys;
      let i = 0;
      for (const k of this.buckets.keys()) {
        this.buckets.delete(k);
        if (++i >= overflow) break;
      }
    }
  }
}

/**
 * Token-bucket limiter for the watcher and provider clients — smooths bursts so
 * an RPC node or an upstream gift-card API never sees a thundering herd.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly capacity: number, private readonly refillPerSec: number) {
    this.tokens = capacity;
  }

  tryRemove(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Returns ms to wait before `n` tokens are available (0 if available now). */
  msUntil(n = 1): number {
    this.refill();
    if (this.tokens >= n) return 0;
    return Math.ceil(((n - this.tokens) / this.refillPerSec) * 1000);
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
      this.last = now;
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; maxMs?: number; onError?: (e: unknown, attempt: number) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 300;
  const maxMs = opts.maxMs ?? 8_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      opts.onError?.(e, i);
      if (i === attempts - 1) break;
      const exp = Math.min(maxMs, baseMs * 2 ** i);
      await sleep(Math.floor(Math.random() * exp)); // full jitter
    }
  }
  throw lastErr;
}