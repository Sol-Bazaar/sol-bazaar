/**
 * Tango Card (RaaS API) provider adapter.
 *
 * Docs: https://dev.tangocard.com/raas/v2/
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 *   TANGO_API_USERNAME=...            from https://app.tangocard.com
 *   TANGO_API_PASSWORD=...            (or use TANGO_API_TOKEN for token auth)
 *   TANGO_BASE_URL=https://api.tangocard.com/raas/v2  (sandbox: https://integration-api.tangocard.com/raas/v2)
 *   TANGO_WEBHOOK_SECRET=...          used to verify inbound webhooks
 *
 * ── Notes ────────────────────────────────────────────────────────────────────
 * Tango uses a different model: accounts hold funds, you create orders against
 * an account. Each order specifies a brand, value, and recipient. The API is
 * synchronous for electronic delivery — codes are returned immediately on success.
 *
 * This adapter maps our catalogue model onto Tango's:
 *   - Product.externalId → Tango brand key (e.g. "amazon.com")
 *   - Denomination.providerSku → Tango denomination SKU or face value string
 *   - syncCatalog() fetches available brands + denominations from /catalog
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

const log = createLogger({ service: 'provider:tango' });

export interface TangoConfig {
  /** Username for basic auth (preferred over token). */
  username?: string;
  /** Password for basic auth. */
  password?: string;
  /** Alternative: bearer token (mutually exclusive with username/password). */
  token?: string;
  baseUrl?: string;
  webhookSecret?: string;
  /** Currency we bill the provider in (default USD). */
  currency?: string;
  /** Account identifier to charge orders against. */
  accountIdentifier?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface TangoBrand {
  key: string;
  name: string;
  description?: string;
  imageUrl?: string;
  termsOfServiceUrl?: string;
  countries: string[];
  denominations: TangoDenomination[];
  isElectronic: boolean;
}

interface TangoDenomination {
  faceValue: string; // e.g. "25.00"
  currency: string;
  sku?: string;
}

interface TangoOrderResponse {
  orderId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  claimUrl?: string;
  reward?: {
    rewardId: string;
    brandKey: string;
    faceValue: string;
    currency: string;
    code?: string;
    pin?: string;
    expirationDate?: string;
  };
  errorMessage?: string;
}

const STATUS_MAP: Record<string, ProviderOrderResult['status']> = {
  SUCCESS: 'DELIVERED',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
};

export class TangoGiftCardProvider implements GiftCardProvider {
  readonly key = 'tango';
  readonly displayName = 'Tango Card';
  readonly supportsWebhook = true;

  private readonly baseUrl: string;
  private readonly currency: string;
  private readonly accountIdentifier: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly bucket = new TokenBucket(10, 15);
  private readonly authHeader: string;

  constructor(private readonly cfg: TangoConfig) {
    if (!cfg.accountIdentifier) throw providerError('TANGO_ACCOUNT_IDENTIFIER is not configured');
    if (!cfg.username && !cfg.token) throw providerError('TANGO_API_USERNAME or TANGO_API_TOKEN is not configured');

    this.baseUrl = (cfg.baseUrl ?? 'https://api.tangocard.com/raas/v2').replace(/\/$/, '');
    this.currency = cfg.currency ?? 'USD';
    this.accountIdentifier = cfg.accountIdentifier;
    this.timeoutMs = cfg.timeoutMs ?? 20_000;
    this.maxRetries = cfg.maxRetries ?? 4;

    if (cfg.token) {
      this.authHeader = `Bearer ${cfg.token}`;
    } else if (cfg.username && cfg.password) {
      const creds = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
      this.authHeader = `Basic ${creds}`;
    } else {
      throw providerError('Tango auth not configured: provide token or username+password');
    }
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST',
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
              Authorization: this.authHeader,
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });

          const text = await res.text();
          if (!res.ok) {
            const retriable = res.status === 429 || res.status >= 500;
            const err: any = providerError(`Tango ${method} ${path} -> ${res.status}`, {
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

  async syncCatalog(opts: { country?: string; category?: string; maxPages?: number } = {}): Promise<ProviderCatalogItem[]> {
    const res = await this.request<{ brands: TangoBrand[] }>('GET', '/catalog');
    const country = (opts.country ?? 'US').toUpperCase();

    const out: ProviderCatalogItem[] = [];
    for (const brand of res.brands ?? []) {
      if (!brand.isElectronic) continue; // we only support electronic delivery
      if (!brand.countries.some((c) => c.toUpperCase() === country)) continue;

      const denominations: ProviderDenomination[] = [];
      for (const d of brand.denominations ?? []) {
        const face = new Decimal(d.faceValue);
        denominations.push({
          faceValue: face,
          currency: d.currency,
          ...(d.sku ? { sku: d.sku } : {}),
          costUsd: face, // Tango charges face value (no discount model in API)
          inStock: true,
        });
      }

      out.push({
        externalId: brand.key,
        name: brand.name,
        description: brand.description,
        brand: brand.name,
        logoUrl: brand.imageUrl,
        countries: brand.countries.map((c) => c.toUpperCase()),
        denominations: denominations.filter((d) => d.inStock !== false),
        inStock: true,
      });
    }

    log.info('catalog_synced', { count: out.length });
    return out;
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  async createOrder(req: ProviderOrderRequest): Promise<ProviderOrderResult> {
    // Tango expects one order per brand+value+recipient. We batch lines into separate orders.
    // For simplicity, we process the first line and return its result.
    // A production implementation would create multiple orders and aggregate results.
    const line = req.lines[0];
    if (!line) throw providerError('No order lines provided');

    const payload = {
      accountIdentifier: this.accountIdentifier,
      sku: line.sku ?? line.externalId,
      amount: line.faceValue.toFixed(2),
      currency: line.currency,
      recipient: {
        email: req.email,
        ...(req.fullName ? { name: req.fullName } : {}),
      },
      sender: {
        name: 'Sol Bazaar',
        email: 'orders@solbazaar.com',
      },
      // Our orderId becomes the externalRef for idempotency
      externalRef: req.orderId,
      utid: req.orderNumber, // Unique transaction ID for Tango
    };

    const res = await this.request<TangoOrderResponse>('POST', '/orders', payload, `tango_${req.orderId}`);
    return this.mapOrder(res);
  }

  async getOrder(externalId: string): Promise<ProviderOrderResult | null> {
    try {
      const res = await this.request<TangoOrderResponse>('GET', `/orders/${encodeURIComponent(externalId)}`);
      return this.mapOrder(res);
    } catch (e) {
      if (/404/.test((e as Error).message)) return null;
      throw e;
    }
  }

  private mapOrder(res: TangoOrderResponse): ProviderOrderResult {
    const codes: ProviderCode[] = [];

    if (res.reward?.code) {
      codes.push({
        code: res.reward.code,
        pin: res.reward.pin ?? null,
        faceValue: res.reward.faceValue ? new Decimal(res.reward.faceValue) : null,
        currency: res.reward.currency ?? this.currency,
        expiresAt: res.reward.expirationDate ? new Date(res.reward.expirationDate) : null,
      });
    }

    const status = STATUS_MAP[res.status] ?? 'PROCESSING';
    const failureReason = res.status === 'FAILED' ? (res.errorMessage ?? 'provider_rejected') : undefined;

    return {
      externalId: res.orderId,
      status,
      codes,
      failureReason,
      pollable: status === 'PENDING',
      raw: res as unknown as Record<string, unknown>,
    };
  }

  async refund(externalId: string): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.request('POST', `/orders/${encodeURIComponent(externalId)}/cancel`, {});
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
   * Signature header: `X-Tango-Signature` (HMAC-SHA256 hex of the raw body).
   */
  parseWebhook(rawBody: string, headers: Record<string, string>): ProviderWebhookEvent {
    const secret = this.cfg.webhookSecret;
    const sig = headers['x-tango-signature'] ?? headers['X-Tango-Signature'];

    if (secret) {
      if (!sig) throw providerError('Missing X-Tango-Signature');
      const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(sig, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw providerError('Invalid webhook signature');
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw providerError('TANGO_WEBHOOK_SECRET is not set');
    } else {
      log.warn('TANGO_WEBHOOK_SECRET not set — accepting unsigned webhooks (dev only)');
    }

    const data = JSON.parse(rawBody) as TangoOrderResponse & { event?: string };
    const mapped = this.mapOrder(data);
    return {
      eventId: `${data.orderId}:${mapped.status}:${mapped.codes.length}`,
      externalId: mapped.externalId,
      status: mapped.status,
      codes: mapped.codes,
      raw: data,
    };
  }
}