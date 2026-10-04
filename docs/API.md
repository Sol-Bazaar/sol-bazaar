# REST API

Base URL: `https://your-domain.com/api/v1`

All responses share one envelope:

```jsonc
// success
{ "data": { ... }, "meta": { ... } }

// failure
{ "error": { "code": "validation_failed", "message": "...", "details": [ ... ] } }
```

Errors use stable HTTP codes: `400 bad_request`, `401 unauthorized`,
`403 forbidden`, `404 not_found`, `409 conflict`, `409 out_of_stock`,
`410 payment_expired`, `422 validation_failed`, `429 rate_limited`,
`502 provider_error`.

---

## Authentication

Two separate credentials, deliberately not interchangeable.

### Public (no key)

Catalog reads are public but **host-scoped**: your tenant is resolved from the
`Host` header (or `X-Tenant-Slug`), so a partner can never see another
merchant's pricing or products.

```bash
curl "https://gift.example.com/api/v1/catalog?country=US&limit=5"
```

### Partner (API key)

```bash
Authorization: Bearer fc_live_ab12cd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Scopes: `catalog:read`, `orders:read`, `orders:write`, `fulfillment:read`,
`webhooks:write`.

`fulfillment:read` is intentionally separate from `orders:read`: a partner that
only needs order state cannot silently start draining gift cards.

Keys are stored as scrypt hashes and compared in constant time. Rate limits come
from `ApiKey.rateLimitPerMin` (per key) with a tighter global default for
anonymous callers. `X-RateLimit-*` headers are always returned.

---

## Catalogue

### `GET /catalog`

Products filtered to the caller's market.

| Param | Type | Notes |
|---|---|---|
| `country` | ISO-3166-1 alpha-2 | Overrides geo detection |
| `category` / `brand` | slug | |
| `q` | string | Name, description, brand, tag, **category name** |
| `minPrice` / `maxPrice` | number | USD, on the cheapest denomination |
| `featured` | bool | |
| `sort` | enum | `relevance` `price_asc` `price_desc` `name` `newest` `popular` |
| `limit` | 1–100 | default 24 |
| `cursor` | string | from `meta.pagination.nextCursor` |

```bash
curl "https://gift.example.com/api/v1/catalog?country=DE&category=gaming&limit=3"
```

```jsonc
{
  "data": {
    "tenant": { "slug": "sol-bazaar", "name": "Sol Bazaar", "markupBps": 500 },
    "country": "DE",
    "categories": [
      { "slug": "gaming", "name": "Gaming", "icon": "🎮", "group": null, "productCount": 10 }
    ],
    "priceBoard": [ { "symbol": "SOL", "usd": "121.02", "decimals": 9, "mint": null } ],
    "products": [
      {
        "id": "…", "slug": "steam-wallet", "name": "Steam Wallet Code",
        "shortName": "Steam", "logoUrl": "…",
        "category": { "slug": "gaming", "name": "Gaming", "group": null },
        "brand": { "slug": "valve", "name": "Valve" },
        "priceFromUsd": 21, "minFaceValue": 20,
        "denominations": [ { "faceValue": "20.00", "currency": "USD", "priceUsd": "21.00", "available": true } ],
        "inStock": true, "stock": 320, "isFeatured": true,
        "rating": 4.9, "reviewCount": 4567
      }
    ]
  },
  "meta": {
    "rateLimit": { "limit": 240, "remaining": 239, "resetAt": 1772… },
    "pagination": { "limit": 3, "nextCursor": null },
    "geo": { "country": "DE", "source": "cdn" }
  }
}
```

### `GET /products/{slug}`

One product. Returns **404** (never 403) when it exists but isn't sellable in the
caller's country, so the endpoint can't be used to discover restricted SKUs.

---

## Orders

### `POST /orders` — requires `orders:write`

```bash
curl -X POST https://gift.example.com/api/v1/orders \
  -H "Authorization: Bearer $FC_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
        "email": "buyer@example.com",
        "token": "SOL",
        "country": "US",
        "lines": [
          { "productSlug": "netflix", "denomination": "50.00", "quantity": 2 }
        ]
      }'
```

`email` is **required** — codes are delivered there and shown on the order page.

`201`:

```jsonc
{
  "data": {
    "id": "cm…", "orderNumber": "FC-7KQ4M2", "status": "PENDING_PAYMENT",
    "totals": {
      "subtotalUsd": "100.0000",     // face values
      "discountUsd": "0.0000",
      "platformFeeUsd": "1.0000",    // our 1%, on top of the merchant's markup
      "platformFeeBps": 100,
      "totalUsd": "106.0000"         // what the customer must send
    },
    "payment": {
      "token": "SOL", "mint": null, "decimals": 9,
      "amountCrypto": "0.882744846",
      "amountAtomic": "882744846",
      "tokenUsd": "121.02",
      "depositAddress": "…",
      "associatedTokenAddress": null,
      "expiresAt": "2026-10-04T04:15:00.000Z",
      "toleranceBps": 150
    },
    "tracking": {
      "url": "https://gift.example.com/track/FC-7KQ4M2?t=…",
      "token": "…"
    },
    "items": [ … ]
  }
}
```

> **Store the tracking token.** Only its SHA-256 hash is persisted, so this is
> the one time it is returned. Losing it is recoverable (the email route still
> works) but inconvenient.

**Idempotency.** Send `Idempotency-Key`. Repeating it returns the *original*
order — same payment address, same quote — instead of a second charge. Retry
freely on network errors.

**Stock** is reserved inside the order transaction. Concurrent orders cannot
oversell; a shortfall returns `409 out_of_stock` naming the product.

### `GET /orders/{orderNumber|id}` — requires `orders:read`

```bash
curl -H "Authorization: Bearer $FC_KEY" \
  "https://gift.example.com/api/v1/orders/FC-7KQ4M2"
```

Accepts the internal id or the human `orderNumber`. Returns live payment
progress:

```jsonc
"payment": {
  "requiredAtomic": "882744846",   // after tolerance — what you must send
  "receivedAtomic": "882744846",
  "paid": true,
  "paidAt": "2026-10-04T03:44:50.000Z",
  "confirmations": 32,
  "expired": false,
  "transactionCount": 1,
  "underpaidUsd": null,
  "overpaidUsd": null
}
```

`underpaidUsd` is populated when a partial payment lands, so you can tell the
customer exactly what is still missing.

---

## Fulfilment

### `GET /orders/{id}/fulfillment` — requires `fulfillment:read`

```jsonc
{
  "data": {
    "status": "DELIVERED",
    "codeCount": 2,
    "codes": [ { "code": "GIFT-CARD-CODE", "pin": null, "faceValue": "50.00", "currency": "USD", "expiresAt": null } ]
  }
}
```

Codes are stored AES-256-GCM encrypted and decrypted only here. Returns `409`
while the order is unpaid — fulfilment is blocked until the chain confirms.

> Treat this endpoint as a vault: anyone who can call it can redeem the value.
> Never expose the key client-side.

---

## Tracking (public)

### `GET /api/track/{orderNumber}?t={token}`

No API key. The opaque tracking token proves ownership; only its hash is stored.

Returns the payment timeline, the on-chain transactions, and — once the order is
`COMPLETED` — the codes. Polls every few seconds while an order is pending.

```jsonc
{
  "data": {
    "status": "COMPLETED",
    "timeline": {
      "createdAt": "…", "paidAt": "…", "codesIssuedAt": "…", "emailSentAt": "…",
      "deliveryLatencyMs": 470,
      "withinSla": true              // our promise is under 4 minutes
    },
    "codes": [ … ]
  }
}
```

A wrong token, a missing token and an unknown order all return `403` with the
**same** message, so the endpoint cannot be used to enumerate order numbers.

Browser equivalent: `/track/FC-7KQ4M2?t=…` — live progress, then the codes.

---

## Webhooks

Register an endpoint per tenant (`WebhookEndpoint`). Signed with HMAC-SHA256:

```
X-SolBazaar-Signature: t=<unix>,v1=<hex hmac of "<unix>.<raw body>">
X-SolBazaar-Delivery: <delivery id>
X-SolBazaar-Event:   <event>
```

```js
const [t, v1] = header.split(',').map(p => p.split('=')[1]);
const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest('hex');
if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) reject();
if (Math.abs(Date.now()/1000 - Number(t)) > 300) reject();   // replay window
```

Events: `order.created`, `order.paid`, `order.fulfilled`, `order.failed`,
`order.expired`, `order.refunded`.

Non-2xx responses retry with exponential backoff (6 attempts, ~1h ceiling).
`order.paid` fires on confirmation; `order.fulfilled` when codes exist — never
before, so a handler can rely on it.

---

## Issuer webhooks (inbound)

Configure your gift-card issuer to POST to:

```
POST /api/v1/webhooks/issuer/recharge
```

Signature verified against the **raw body**, then `401`/2xx. Always returns
`200` once verified — an error would make the issuer retry forever. Order is
matched on the issuer's own order id, which we set to our order id.

Without `RECHARGE_WEBHOOK_SECRET` configured in production the endpoint refuses
unsigned payloads (fail closed).

---

## Operator endpoints (not tenant-scoped)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | Liveness + queue depth + delivery SLA |
| `GET /api/admin/fees` | `Bearer $OPERATOR_TOKEN` | Platform-fee totals, pending balances, sweep history with explorer links |

```bash
curl -H "Authorization: Bearer $OPERATOR_TOKEN" https://your-domain.com/api/admin/fees
```

```jsonc
{
  "data": {
    "collector": "EKCMKKGehtGp9UtYvAigogmbfBCHsSbMdMWLfsQNY8yZ",
    "feeBps": 100,
    "totals": [ { "token": "SOL", "totalAtomic": "…", "sweptAtomic": "…", "unsweptAtomic": "…" } ],
    "pending": [ { "token": "SOL", "atomic": "…", "orderCount": 12 } ],
    "sweeps":  [ { "token": "SOL", "signature": "…", "explorer": "https://solscan.io/tx/…", "confirmedAt": "…" } ]
  }
}
```

---

## Order lifecycle

```
PENDING_PAYMENT ──payment confirmed──► PAID ──issuer called──► FULFILLING ──► COMPLETED
       │                                 │                          │
       ├─ window closed ─► EXPIRED        └─ issuer error ─────────┴──► FAILED
       │                                  (stock released)
       └─ partial payment: stays PENDING, `underpaidUsd` set,
          another transfer to the same address is credited automatically
```

Transitions are conditional `UPDATE`s, so concurrent workers cannot both trigger
one. Fulfilment requires `PAID`; there is no path from `PENDING_PAYMENT` to an
issuer call.