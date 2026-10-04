import type { Decimal } from 'decimal.js';

/**
 * The contract every gift-card issuer integration must satisfy.
 *
 * Keeping this narrow is what makes the platform genuinely white-label: swapping
 * Recharge for Tremendous, Tolarity or your own in-house issuer is one new file
 * plus a registry entry — no change to orders, payments or the storefront.
 */

export interface ProviderCatalogItem {
  /** Provider-side product id (what we store in Product.externalId). */
  externalId: string;
  name: string;
  description?: string;
  brand?: string;
  logoUrl?: string;
  /** ISO country / region codes the product can be delivered into. */
  countries: string[];
  denominations: ProviderDenomination[];
  /** True when the provider itself has no stock right now. */
  inStock?: boolean;
}

export interface ProviderDenomination {
  /** Face value in the product's currency, e.g. 50.00 */
  faceValue: Decimal;
  currency: string;
  /** Issuer-side SKU for this denomination (Recharge requires it on orders). */
  sku?: string;
  /** What the provider charges us (before our markup). */
  costUsd?: Decimal;
  inStock?: boolean;
}

export interface ProviderOrderRequest {
  /** Our order id — used as the provider idempotency key. */
  orderId: string;
  orderNumber: string;
  email: string;
  fullName?: string;
  country: string;
  ip?: string;
  lines: ProviderOrderLine[];
}

export interface ProviderOrderLine {
  /** Provider product id (Product.externalId). */
  externalId: string;
  /** Issuer SKU for the chosen denomination (Denomination.providerSku). */
  sku?: string;
  faceValue: Decimal;
  currency: string;
  quantity: number;
}

export interface ProviderOrderResult {
  /** Provider's own order id — persisted as Fulfillment.externalId (unique). */
  externalId: string;
  status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED';
  /** One or more redeemable codes. Empty until the issuer completes. */
  codes: ProviderCode[];
  raw?: unknown;
  /** Non-null when the provider rejected the order outright. */
  failureReason?: string;
  /** Ask us to poll `getOrder` instead of waiting for a webhook. */
  pollable?: boolean;
}

export interface ProviderCode {
  code: string;
  /** Secondary PIN for brands that use a two-part code (e.g. some AU cards). */
  pin?: string | null;
  faceValue?: Decimal | null;
  currency?: string | null;
  expiresAt?: Date | null;
}

export interface GiftCardProvider {
  readonly key: string;
  readonly displayName: string;
  readonly supportsWebhook: boolean;

  /** Pull the issuer's live catalogue so we can price against real stock. */
  syncCatalog(): Promise<ProviderCatalogItem[]>;

  /** Submit an order. Must be idempotent on `orderId`. */
  createOrder(req: ProviderOrderRequest): Promise<ProviderOrderResult>;

  /** Poll an existing order (used when no webhook arrives). */
  getOrder(externalId: string): Promise<ProviderOrderResult | null>;

  /** Optional: cancel / refund a not-yet-delivered order. */
  refund?(externalId: string): Promise<{ ok: boolean; message?: string }>;
}

export interface ProviderWebhookEvent {
  eventId: string;
  externalId: string;
  status: ProviderOrderResult['status'];
  codes: ProviderCode[];
  raw?: unknown;
}