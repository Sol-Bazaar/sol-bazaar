/**
 * Shared HTTP plumbing for the `/api/v1` surface.
 *
 * Guarantees a single, stable response envelope for partners:
 *   success -> { "data": ..., "meta": ... }
 *   failure -> { "error": { "code", "message", "details"? } }
 *
 * plus consistent rate-limit headers, request ids, and no accidental caching.
 */
import { NextResponse } from 'next/server';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { randomUUID } from 'node:crypto';
import { normaliseError, isAppError, createLogger, MemoryRateLimiter } from '@solbazaar/core';

const log = createLogger({ service: 'api' });

/**
 * Shared limiter instance.
 *
 * In-process, so it is per-node. That is correct for a single-instance deploy
 * and still a useful first line of defence behind several instances — to make
 * the budget truly global, swap `MemoryRateLimiter` for a Redis-backed one
 * implementing the same `RateLimiter` interface (nothing else changes).
 */
export const globalLimiter = new MemoryRateLimiter();

export interface ApiMeta {
  requestId?: string;
  rateLimit?: { limit: number; remaining: number; resetAt: number; retryAfterSec: number };
  pagination?: { limit: number; nextCursor: string | null };
  [k: string]: unknown;
}

export function jsonOk<T>(data: T, opts: { meta?: ApiMeta; status?: number; req?: Request } = {}): NextResponse {
  const requestId = opts.meta?.requestId ?? randomUUID();
  const body = { data, ...(opts.meta ? { meta: opts.meta } : {}) };
  const headers: Record<string, string> = { 'X-Request-Id': requestId };
  if (opts.meta?.rateLimit) {
    headers['X-RateLimit-Limit'] = String(opts.meta.rateLimit.limit);
    headers['X-RateLimit-Remaining'] = String(opts.meta.rateLimit.remaining);
    headers['X-RateLimit-Reset'] = String(Math.floor(opts.meta.rateLimit.resetAt / 1000));
  }
  return NextResponse.json(body, { status: opts.status ?? 200, headers });
}

export function jsonError(e: unknown, req?: Request): NextResponse {
  const n = normaliseError(e);
  const requestId = req?.headers.get('x-request-id') ?? randomUUID();

  const headers: Record<string, string> = { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' };
  const retryAfter = (e as { retryAfter?: number } | undefined)?.retryAfter;
  if (retryAfter) headers['Retry-After'] = String(retryAfter);

  if (n.status >= 500) {
    log.error('api_error', { requestId, code: n.code, msg: n.message, stack: (e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') });
  } else {
    log.warn('api_client_error', { requestId, code: n.code, msg: n.message });
  }

  return NextResponse.json(
    { error: { code: n.code, message: n.message, ...(n.details !== undefined ? { details: n.details } : {}), requestId } },
    { status: n.status, headers },
  );
}

/** Wrap a handler so every thrown error becomes the standard envelope. */
export function handler<A extends any[]>(
  fn: (req: Request, ...args: A) => Promise<NextResponse>,
): (req: Request, ...args: A) => Promise<NextResponse> {
  return async (req, ...args) => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      return jsonError(e, req);
    }
  };
}

/**
 * Validate a payload with zod, converting failures into a 422 with field paths.
 *
 * Generic over both input and output types (`ZodSchema` pins them to the same
 * type, which silently resolves to the *input* side for any schema containing a
 * `.transform()` — e.g. `?featured=true`).
 */
export async function parseBody<Out, In = unknown>(req: Request, schema: ZodType<Out, ZodTypeDef, In>): Promise<Out> {
  let raw: unknown;
  const ct = req.headers.get('content-type') ?? '';
  try {
    raw = ct.includes('application/json') ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);
  } catch {
    throw Object.assign(new Error('Request body is not valid JSON'), { code: 'bad_request' });
  }
  try {
    return schema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) {
      throw Object.assign(
        new Error('Validation failed'),
        {
          code: 'validation_failed',
          details: e.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message, code: i.code })),
        },
      );
    }
    throw e;
  }
}

export function parseQuery<Out, In = Record<string, string>>(url: string, schema: ZodType<Out, ZodTypeDef, In>): Out {
  const params = Object.fromEntries(new URL(url).searchParams);
  try {
    return schema.parse(params);
  } catch (e) {
    if (e instanceof ZodError) {
      throw Object.assign(new Error('Invalid query parameters'), {
        code: 'validation_failed',
        details: e.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    throw e;
  }
}

/**
 * Rate-limit a request. Keyed by API key when present, else by client IP.
 * Partner limits come from their ApiKey row; anonymous callers get the global
 * budget, which is tighter.
 */
export async function enforceRateLimit(req: Request, perMinute?: number): Promise<{
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}> {
  const auth = req.headers.get('authorization');
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'anonymous';
  const key = auth ? `key:${auth.slice(-16)}` : `ip:${ip}`;
  const limit = perMinute ?? Number(process.env.RATE_LIMIT_PER_MIN ?? 120);

  const r = await globalLimiter.hit(key, limit, 60_000);
  if (!r.allowed) {
    throw Object.assign(new Error('Rate limit exceeded'), { code: 'rate_limited', status: 429, retryAfter: r.retryAfterSec });
  }
  return r;
}
