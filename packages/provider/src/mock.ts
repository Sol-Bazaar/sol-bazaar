/**
 * Sandbox provider — issues instantly, no upstream dependency.
 *
 * Two jobs:
 *  1. End-to-end development of the whole pipeline (order -> chain -> codes)
 *     without spending money or needing an issuer account.
 *  2. A safety net in production: if the real issuer is down, fulfillment fails
 *     loudly and retries rather than silently issuing fake codes.
 *
 * Set PROVIDER_REQUIRE_REAL=true in production to hard-disable this.
 */
import { randomBytes, createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { providerError } from '@solbazaar/core';
import type {
  GiftCardProvider,
  ProviderCatalogItem,
  ProviderCode,
  ProviderOrderRequest,
  ProviderOrderResult,
  ProviderWebhookEvent,
} from './types';

interface MockState {
  orders: Map<string, ProviderOrderResult>;
  byIdempotency: Map<string, string>;
}

export class MockGiftCardProvider implements GiftCardProvider {
  readonly key = 'mock';
  readonly displayName = 'Sandbox (instant, no upstream)';
  readonly supportsWebhook = false;

  private state: MockState = { orders: new Map(), byIdempotency: new Map() };
  /** Simulated issuer latency so the queue/retry paths get exercised. */
  private latencyMs: number;

  constructor(opts: { latencyMs?: number } = {}) {
    this.latencyMs = opts.latencyMs ?? Number(process.env.MOCK_PROVIDER_LATENCY_MS ?? 350);
  }

  async syncCatalog(): Promise<ProviderCatalogItem[]> {
    // The mock issuer has no independent catalogue — the seeded DB *is* the
    // catalogue. Returning [] tells the sync job to leave pricing alone.
    return [];
  }

  async createOrder(req: ProviderOrderRequest): Promise<ProviderOrderResult> {
    // Idempotency on our order id — a retry must never buy a second card.
    const existingId = this.state.byIdempotency.get(req.orderId);
    if (existingId) {
      const prev = this.state.orders.get(existingId);
      if (prev) return { ...prev, pollable: false };
    }

    if (process.env.PROVIDER_REQUIRE_REAL === 'true') {
      throw providerError('Sandbox provider is disabled (PROVIDER_REQUIRE_REAL=true)');
    }
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));

    const externalId = `mock_${req.orderNumber.toLowerCase().replace(/-/g, '')}_${randomBytes(3).toString('hex')}`;
    const codes: ProviderCode[] = [];

    for (const line of req.lines) {
      for (let i = 0; i < line.quantity; i++) {
        codes.push({
          code: generateMockCode(externalId, line.externalId, i),
          pin: null,
          faceValue: line.faceValue,
          currency: line.currency,
          expiresAt: null,
        });
      }
    }

    const result: ProviderOrderResult = {
      externalId,
      status: 'DELIVERED',
      codes,
      raw: { mock: true, lines: req.lines.length, codeCount: codes.length },
    };
    this.state.orders.set(externalId, result);
    this.state.byIdempotency.set(req.orderId, externalId);
    return result;
  }

  async getOrder(externalId: string): Promise<ProviderOrderResult | null> {
    return this.state.orders.get(externalId) ?? null;
  }

  async refund(externalId: string) {
    const o = this.state.orders.get(externalId);
    if (!o) return { ok: false, message: 'not_found' };
    this.state.orders.delete(externalId);
    return { ok: true, message: 'refunded' };
  }

  parseWebhook(rawBody: string, headers: Record<string, string>): ProviderWebhookEvent {
    throw providerError('Sandbox provider does not receive webhooks');
  }
}

/** Deterministic, obviously-fake code: `FAKE-XXXX-XXXX-XXXX-XXXX`. */
function generateMockCode(externalId: string, productId: string, n: number): string {
  const h = createHash('sha256').update(`${externalId}:${productId}:${n}`).digest('hex').toUpperCase();
  return `FAKE-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}

export function mockDenoms(values: number[] | string[]): { faceValue: Decimal; currency: string }[] {
  return values.map((v) => ({ faceValue: new Decimal(String(v)), currency: 'USD' }));
}