/**
 * Recharge.com provider adapter (Recharge API v1).
 *
 * Maps Recharge's products/denominations/orders model onto our internal
 * `GiftCardProvider` contract. Business logic lives in `@solbazaar/fulfillment`
 * — this file is pure transport + shape translation.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 *   RECHARGE_API_KEY=...            from https://app.rechargeapps.com
 *   RECHARGE_BASE_URL=https://api.rechargeapps.com/v1
 *   RECHARGE_WEBHOOK_SECRET=...     used to verify inbound webhooks
 *
 * ── Verify against current docs before going live ───────────────────────────
 * Recharge's payload has changed shape several times (they introduced `sku`,
 * moved `denominations` to `prices`, renamed `gift_card.code`). The mapping is
 * isolated in `mapProduct` / `mapOrder` precisely so that a schema change is a
 * local edit. Each mapper notes the fields it relies on.
 *
 * ── Settlement model ─────────────────────────────────────────────────────────
 * Recharge bills on a payment schedule (post-paid), so placing an order is
 * safe. We only place one *after* the customer's Solana payment has reached the
 * required confirmation depth, so we never carry gift-card liability for an
 * unconfirmed deposit.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import Decimal from 'decimal.js';
import { providerError, withRetry, sleep, TokenBucket, createLogger } from '@solbazaar/core';
import type {
  GiftCardProvider,
  ProviderCatalogItem,
  ProviderCode,
  ProviderDenomination,
  ProviderOrderRequest,
  ProviderOrderResult,
  ProviderWebhookEvent,
} from './types';

const log = createLogger({ service: 'provider:recharge' });

export interface RechargeConfig {
  apiKey: string;
  baseUrl?: string;
  webhookSecret?: string;
  /** Currency we bill the provider in. */
  currency?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface RechargeDenomination {
  sku?: string;
  price?: { face_value?: number | string; discount_price?: number | string };
  // Legacy shape, kept for older API versions.
  face_value?: number | string;
  in_stock?: boolean;
}

interface RechargeProduct {
  id: string | number;
  name: string;
  description?: string;
  brand_name?: string;
  country_codes?: string[];
  images?: { svg?: string; png?: string; jpg?: string };
  denominations?: RechargeDenomination[];
  prices?: RechargeDenomination[];
  online?: boolean;
}

interface RechargeOrderResponse {
  id: string | number;
  status?: string;
  payment_status?: string;
  products?: {
    id: string | number;
    quantity?: number;
    unit_price?: number | string;
    currency?: string;
    gift_card?: {
      code?: string;
      pin?: string | null;
      expires_at?: string | null;
      unit_price?: number | string;
      currency?: string;
    };
  }[];
}

const STATUS_MAP: Record<string, ProviderOrderResult['status']> = {
  pending: 'PENDING',
  processing: 'PROCESSING',
  paid: 'PROCESSING',
  delivered: 'DELIVERED',
  completed: 'DELIVERED',
  success: 'DELIVERED',
  cancelled: 'FAILED',
  canceled: 'FAILED',
  failed: 'FAILED',
  refunded: 'FAILED',
};

export class RechargeGiftCardProvider implements GiftCardProvider {
  readonly key = 'recharge';
  readonly displayName = 'Recharge.com';
  readonly supportsWebhook = true;

  private readonly baseUrl: string;
  private readonly currency: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly bucket = new TokenBucket(8, 12);

  constructor(private readonly cfg: RechargeConfig) {
    if (!cfg.apiKey) throw providerError('RECHARGE_API_KEY is not configured');
    this.baseUrl = (cfg.baseUrl ?? 'https://api.rechargeapps.com/v1').replace(/\/$/, '');
    this.currency = cfg.currency ?? 'USD';
    this.timeoutMs = cfg.timeoutMs ?? 20_000;
    this.maxRetries = cfg.maxRetries ?? 4;
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    return withRetry(
      async () => {
        const wait = this.bucket.msUntil(1);
        if (wait > 0) await sleep(wait);
        this.bucket.tryRemove(1);

        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
        try {
          const res = await fetch(url, {
            method,
            signal: ctl.signal,
            headers: {
              'X-API-KEY': this.cfg.apiKey,
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });

          const text = await res.text();
          if (!res.ok) {
            const retriable = res.status === 429 || res.status >= 500;
            const err: any = providerError(`Recharge ${method} ${path} -> ${res.status}`, {
              status: res.status,
              body: text.slice(0, 500),
              retriable,
            });
            if (retriable) throw err;
            err.__final = true;
            throw err;
          }
          return (text ? JSON.parse(text) : {}) as T;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        attempts: this.maxRetries,
        onError: (e, i) => log.warn('request_retry', { path, attempt: i, err: (e as Error).message }),
      },
    );
  }

  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------

  /** Walks the paginated product list until exhausted or `maxPages` is hit. */
  async syncCatalog(opts: { country?: string; category?: string; maxPages?: number } = {}): Promise<ProviderCatalogItem[]> {
    const out: ProviderCatalogItem[] = [];
    const maxPages = opts.maxPages ?? 25;
    let page = 1;

    for (; page <= maxPages; page++) {
      const qs = new URLSearchParams({
        limit: '250',
        page: String(page),
        ...(opts.country ? { country: opts.country } : {}),
        ...(opts.category ? { category: opts.category } : {}),
      });
      const res = await this.request<{ products?: RechargeProduct[]; meta?: { current_page?: number } }>(
        'GET',
        `/products?${qs.toString()}`,
      );
      const products = res.products ?? [];
      for (const p of products) out.push(this.mapProduct(p, opts.country ?? 'US'));
      if (!res.meta?.current_page || products.length < 250) break;
    }

    log.info('catalog_synced', { count: out.length, pagesVisited: page });
    return out;
  }

  /** Depends on: `id`, `name`, `denominations[].price.{face_value,discount_price}`,
   *  `denominations[].sku`, `country_codes`, `images`, `brand_name`. */
  private mapProduct(p: RechargeProduct, fallbackCountry: string): ProviderCatalogItem {
    const rawDens: RechargeDenomination[] = p.denominations ?? p.prices ?? [];
    const denominations: ProviderDenomination[] = [];

    for (const d of rawDens) {
      const face = d.price?.face_value ?? d.face_value;
      if (face == null) continue;
      const faceDecimal = new Decimal(String(face));
      const discount = d.price?.discount_price;
      denominations.push({
        faceValue: faceDecimal,
        currency: this.currency,
        ...(d.sku ? { sku: d.sku } : {}),
        // `discount_price` is what we actually pay — our cost basis.
        costUsd: discount != null ? new Decimal(String(discount)) : faceDecimal,
        inStock: d.in_stock !== false,
      });
    }

    return {
      externalId: String(p.id),
      name: p.name,
      description: p.description,
      brand: p.brand_name,
      logoUrl: p.images?.svg ?? p.images?.png ?? p.images?.jpg,
      countries: (p.country_codes ?? [fallbackCountry]).map((c) => c.toUpperCase()),
      denominations: denominations.filter((d) => d.inStock !== false),
      inStock: p.online !== false,
    };
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  async createOrder(req: ProviderOrderRequest): Promise<ProviderOrderResult> {
    // `sku` (from Denomination.providerSku) identifies the denomination;
    // `id` (Product.externalId) identifies the product.
    const payload = {
      products: req.lines.map((l) => ({
        id: l.externalId,
        ...(l.sku ? { sku: l.sku } : {}),
        quantity: l.quantity,
        unit_price: l.faceValue.toFixed(2),
      })),
      currency: this.currency,
      customer_id: req.orderId, // our order id -> provider-side idempotency
      customer_email: req.email,
      ...(req.fullName ? { customer_name: req.fullName } : {}),
      ...(req.country ? { customer_country: req.country } : {}),
      ...(req.ip ? { customer_ip: req.ip } : {}),
      locale: 'en-US',
    };

    // The Idempotency-Key header stops a retry from buying a second card set.
    const res = await this.request<RechargeOrderResponse>('POST', '/orders', payload, `fc_${req.orderId}`);
    return this.mapOrder(res);
  }

  async getOrder(externalId: string): Promise<ProviderOrderResult | null> {
    try {
      const res = await this.request<RechargeOrderResponse>('GET', `/orders/${encodeURIComponent(externalId)}`);
      return this.mapOrder(res);
    } catch (e) {
      if (/404/.test((e as Error).message)) return null;
      throw e;
    }
  }

  /** Depends on: `id`, `status`, `payment_status`, `products[].gift_card.{code,pin,expires_at}`. */
  private mapOrder(res: RechargeOrderResponse): ProviderOrderResult {
    const codes: ProviderCode[] = [];
    let failureReason: string | undefined;

    for (const p of res.products ?? []) {
      if (!p.gift_card?.code) {
        if (p.quantity) failureReason ??= `awaiting_fulfilment (${p.quantity} unit(s) not yet issued)`;
        continue;
      }
      const unitPrice = p.unit_price ?? p.gift_card.unit_price;
      codes.push({
        code: p.gift_card.code,
        pin: p.gift_card.pin ?? null,
        faceValue: unitPrice != null ? new Decimal(String(unitPrice)) : null,
        currency: p.currency ?? p.gift_card.currency ?? this.currency,
        expiresAt: p.gift_card.expires_at ? new Date(p.gift_card.expires_at) : null,
      });
    }

    const rawStatus = (res.status ?? '').toLowerCase();
    let status: ProviderOrderResult['status'] = STATUS_MAP[rawStatus] ?? 'PROCESSING';
    if (res.payment_status === 'failed' || res.payment_status === 'declined') status = 'FAILED';
    if (status === 'FAILED') failureReason ??= rawStatus || 'provider_rejected';

    return {
      externalId: String(res.id),
      status,
      codes,
      failureReason,
      pollable: status === 'PENDING' || status === 'PROCESSING',
      raw: res as unknown as Record<string, unknown>,
    };
  }

  async refund(externalId: string): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.request('POST', `/orders/${encodeURIComponent(externalId)}/refund`, {});
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  /**
   * Verify + parse an inbound webhook.
   * Signature header: `X-Recharge-Signature` (HMAC-SHA256 hex of the raw body).
   */
  parseWebhook(rawBody: string, headers: Record<string, string>): ProviderWebhookEvent {
    const secret = this.cfg.webhookSecret;
    const sig = headers['x-recharge-signature'] ?? headers['X-Recharge-Signature'];

    if (secret) {
      if (!sig) throw providerError('Missing X-Recharge-Signature');
      const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(sig, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw providerError('Invalid webhook signature');
      }
    } else if (process.env.NODE_ENV === 'production') {
      // Fail closed in production: an unverified webhook can inject fake codes.
      throw providerError('RECHARGE_WEBHOOK_SECRET is not set');
    } else {
      log.warn('RECHARGE_WEBHOOK_SECRET not set — accepting unsigned webhooks (dev only)');
    }

    const data = JSON.parse(rawBody) as RechargeOrderResponse & { event?: string };
    const mapped = this.mapOrder(data);
    return {
      eventId: `${data.id}:${mapped.status}:${mapped.codes.length}`,
      externalId: mapped.externalId,
      status: mapped.status,
      codes: mapped.codes,
      raw: data,
    };
  }
}