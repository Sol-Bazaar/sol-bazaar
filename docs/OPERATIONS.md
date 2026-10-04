# Operations

Runbooks for when you have real money on the line.

---

## Platform fee sweeping

A 1% fee is charged on every order line, on top of the merchant's markup, and
moved to the collector wallet:

```
PLATFORM_FEE_WALLET=EKCMKKGehtGp9UtYvAigogmbfBCHsSbMdMWLfsQNY8yZ
```

### How it flows

1. Fulfilment completes → one `FeeAccrual` row (`orderId` UNIQUE, so retries
   can't double-book).
2. The sweeper aggregates unswept accruals per token. Once the balance exceeds
   `PLATFORM_FEE_MIN_SWEEP_SOL` (default 5 SOL) it claims a batch with
   `FOR UPDATE SKIP LOCKED`, attaches them to a `FeeSweep`, and submits a real
   transfer from a dedicated HD slot.
3. On confirmation → `CONFIRMED`. On failure → accruals are **detached** and
   retried. Nothing is lost, nothing is double-sent.

Batching matters: one sweep of 500 fees costs a single 5000-lamport signature fee
instead of 500 of them.

### Sweep slots are separate from deposit slots

Deposits use monotonically allocated slots from 0. Sweeping uses
`WALLET_SWEEP_INDEX_SOL` / `_SPL` (default 999000 / 999001), far above the
deposit range, so a sweeping transfer can never be mistaken for a customer
deposit by the payment watcher.

Never lower these below your deposit range.

### Operating it

```bash
# One-off sweep now
npx tsx apps/worker/src/fee-sweeper.ts --force

# Balances and history
curl -H "Authorization: Bearer $OPERATOR_TOKEN" localhost:3000/api/admin/fees

# Loop every 15 min (default FEE_SWEEP_INTERVAL_MS)
WORKER_ROLES=fees npm run dev:worker
```

### Reconciling

`FeeAccrual.atomicAmount` should equal
`floor(Order.amountAtomic × platformFeeBps / 10000)` for every completed order,
and the parts must sum back to the total exactly — the remainder goes to the
merchant, never to rounding dust.

```sql
-- Orders whose stored fee does not match the rule (should be empty)
SELECT "orderNumber", "amountAtomic", "platformFeeAtomic", "platformFeeBps"
FROM "Order"
WHERE status = 'COMPLETED'
  AND "platformFeeAtomic" <> ("amountAtomic"::bigint * "platformFeeBps" / 10000);

-- Accruals never attached to a sweep and older than an hour (investigate)
SELECT count(*) FROM "FeeAccrual" WHERE "sweepId" IS NULL AND "createdAt" < now() - interval '1 hour';

-- Sweeps that failed
SELECT "id", "token", "error" FROM "FeeSweep" WHERE status = 'FAILED' ORDER BY "createdAt" DESC;
```

---

## Refunds

Crypto transfers are irreversible, so automatic refunds are deliberately **not**
implemented. `REFUND_ORDER` jobs log a warning and do nothing. Moving money back
needs a deliberate, audited action.

### Full refund (we failed to deliver)

1. Confirm no codes were issued — `Fulfillment.status` must not be `DELIVERED`.
2. Note the payer address from `Order.depositAddress` and the amount.
3. Build and sign a transfer from an HD slot to that address. Model it on
   `apps/worker/src/fee-sweeper.ts` — the transfer construction is the only
   correct version in the codebase.
4. Record it (mirror the `FeeSweep` shape, or add a `Refund` table first).

```sql
-- Orders that failed and may be refundable
SELECT "orderNumber", "email", "totalUsd", "depositAddress", "token", "amountAtomic"
FROM "Order" WHERE status = 'FAILED';
```

### Overpayment

`Order.overpaidUsd` records the surplus. Same process: return
`receivedAtomic - expectedAtomic` from a sweep slot.

### Expired order with a payment

The maintenance loop flags these loudly as
`refund_needed_expired_with_payment`. Deposits to an expired address are not
auto-refunded — verify the amount, then refund manually.

---

## Incidents

### Payment sent, code never arrived

```sql
SELECT o."orderNumber", o.status, o."receivedAtomic", o."expectedAtomic",
       o."paidAt", o."codesIssuedAt", o."emailSentAt", o.emailError,
       (SELECT count(*) FROM "PaymentTx" p WHERE p."orderId" = o.id) AS tx_count
FROM "Order" o
WHERE o."orderNumber" = 'FC-XXXXXX';
```

| Symptom | Cause | Action |
|---|---|---|
| `receivedAtomic` = 0 | Watcher not running, or RPC failing | `npm run dev:worker`; check `SOLANA_RPC_URLS` |
| `receivedAtomic` > 0, status `PENDING_PAYMENT` | Watcher running but below the confirmation threshold | Wait; check `MIN_CONFIRMATIONS` |
| `receivedAtomic` = `expectedAtomic`, status `PAID` | Job queue stalled | `GET /api/health` → check `pendingJobs` |
| status `FULFILLING`, stuck | Issuer API hung | The worker re-queues automatically; check issuer status |
| status `COMPLETED`, `emailSentAt` null | Email provider failing | Codes are on the order page; fix `EMAIL_API_KEY` |

`checkDeliverySla()` re-queues fulfilments for anything paid more than
`DELIVERY_SLA_MS` ago, so this is usually self-healing.

### Watcher misses a payment

1. Check the transaction exists:
   `getSignaturesForAddress(depositAddressForSPLTokens)` — use `depositAta` for
   SPL, not `depositAddress`.
2. If present but not credited, run `npm run test:chain` — it validates the delta
   logic against live blocks and will fail loudly if Solana changed shape.
3. If `MAX_TX_VERSION` is behind the cluster, `getTransaction` fails with
   `Transaction version (N) is not supported`. Bump the constant.

### Codes unreadable

`CODE_ENCRYPTION_KEY` is wrong or missing. Codes cannot be recovered without it —
confirm the key from your secret store before concluding data loss.

---

## Monitoring

`GET /api/health` — `200` healthy, `200 degraded`, `503 down`:

```jsonc
{
  "status": "ok",
  "pendingJobs": 0,
  "oldestPendingMinutes": 0,
  "deliverySla": {
    "thresholdMs": 240000,
    "paidNotIssued": 0,     // customer paid, no code — act now
    "issuedNotEmailed": 0,  // codes exist, email failing
    "slowDeliveries": 0     // exceeded the 4-minute promise
  }
}
```

`degraded` when the queue is over 10 minutes deep **or** either delivery counter
is non-zero. Wire a load balancer / PagerDuty rule to the status field.

Alert on:

- `paidNotIssued > 0` for more than 2 minutes — customers are waiting on money
  they already sent
- `oldestPendingMinutes > 10`
- `FeeSweep` rows in `FAILED`
- `FeeAccrual` rows unswept for more than a few hours (revenue not collected)

---

## Delivery SLA

The promise is **codes in the inbox within four minutes** of payment confirmation.

Tracked per order: `paidAt` → `codesIssuedAt` → `emailSentAt`, with
`deliveryLatencyMs` on the record and shown on the order page and tracking link.

The email path is not the only delivery route. Codes are shown inline on the
order page and the tracking link the moment fulfilment completes, so an email
provider outage degrades the experience rather than losing a sale.

To tighten or relax the promise: `DELIVERY_SLA_MS` (default `240000`).

---

## Rotating secrets

### `CODE_ENCRYPTION_KEY`

**Requires re-encrypting existing rows.** There is no online rotation.

1. Decrypt all `Fulfillment.codesCipher` values with the old key.
2. Re-encrypt with the new key.
3. Swap the env var, restart.

Until it completes, set the old and new keys side by side in a migration script.
Losing the key without re-encrypting means those codes are unreadable forever.

### `WALLET_MASTER_KEY`

Encrypts the wallet seed and webhook secrets. Rotate the same way: decrypt, then
re-encrypt `Setting.wallet_seed` and every `WebhookEndpoint.secretEnc`.

### API keys

No rotation needed — issue a new key, deploy it, then set `disabledAt` on the
old one. Both work until the old one is disabled.

### Tracking tokens

Only the hash is stored, so the plaintext cannot be recovered. A customer who
loses their link uses the email route (`/orders`). Re-creating the order through
the same idempotency key mints a fresh token.

---

## Backups

Back up **three things, in three different places**:

| What | Why |
|---|---|
| PostgreSQL database | Orders, catalogue, tenant config |
| `WALLET_MASTER_KEY` + `CODE_ENCRYPTION_KEY` | Without them the database is a museum |
| The wallet recovery mnemonic | Without it every deposit address is orphaned |

`pg_dump` is sufficient:

```bash
pg_dump "$DATABASE_URL" -Fc -f "sol-bazaar-$(date +%F).dump"
```

Test a restore into a scratch database before you need one. A backup you have
never restored is a hypothesis.

---

## Scaling

Two processes; split either by role.

```bash
WORKER_ROLES=watcher     # latency-critical: gates how fast a customer gets a card
WORKER_ROLES=jobs        # throughput-critical: issuer calls, emails
WORKER_ROLES=fees        # revenue collection
WORKER_ROLES=maintenance # sweeps, webhook flush, SLA checks
```

Job claims use `FOR UPDATE SKIP LOCKED` and each role holds a Postgres advisory
lock, so extra replicas log and skip rather than double-processing. The advisory
lock is session-scoped, so a crashed process releases it automatically — no stale
lock cleanup.

`web` is stateless and scales horizontally. Point every instance at the same
`APP_URL` and `BASE_DOMAIN`.

### Before you need it

- **RPC** — public endpoints will throttle you. Use a paid provider and set
  `SOLANA_RPC_URLS` with several URLs for failover.
- **Rate limiting** — `MemoryRateLimiter` is per-process. To make the budget
  truly global, implement the same `RateLimiter` interface over Redis; nothing
  else changes.
- **Queue polling** — the claim SQL is fine at high volume; if latency matters,
  add `LISTEN/NOTIFY` so workers wake immediately instead of polling.