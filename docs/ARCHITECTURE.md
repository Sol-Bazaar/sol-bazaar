# Architecture

Design decisions and the reasoning behind them. Where a decision was genuinely
close, the alternative is stated too.

---

## Two processes, not one

```
apps/web      stateless HTTP — storefront + REST API
apps/worker   chain watcher · job runner · maintenance · fee sweeper
```

Splitting them is what makes the latency-critical path independent of the
throughput-critical one. The watcher gates how fast a customer gets their card;
the job runner is doing issuer API calls and sending email. One slow issuer must
never delay a payment being detected.

Further split with `WORKER_ROLES=watcher,jobs,fees,maintenance`. Each role takes
a Postgres advisory lock, so running two watchers logs and skips instead of
double-processing. The lock is session-scoped, so a crash releases it — no stale
lock cleanup.

---

## Per-order deposit addresses

**Decision.** Every order gets its own Solana address, HD-derived at
`m/44'/501'/{index}'/0'` from an encrypted BIP39 seed.

**Alternative considered.** A single pooled address with a memo field or an
amount-encoding scheme. Rejected: it forces you to parse untrusted memo data,
creates a permanent per-deposit reconciliation problem, and makes partial
payments ambiguous.

The cost is a keypair per order (~1ms derivation, memoised). The benefit is
exact attribution — an incoming transaction belongs to precisely one order, with
no heuristics.

**Hardened indices are mandatory.** ed25519 SLIP-0010 cannot derive a child from
a parent *public* key alone, so every index is hardened.

**Index allocation** uses a counter row under `SELECT … FOR UPDATE`. `max+1`
would let two concurrent checkouts compute the same index and share an address.

---

## Balance deltas, not instruction parsing

We compute `postBalances - preBalances` for the account's index rather than
pattern-matching `transfer` instructions. That is robust across every shape a
transfer can take: `transfer`, `transferChecked`, CPI from another program,
memo-carrying transfers, wrapped SOL.

### The index space, precisely

This was verified against live devnet data rather than assumed, and the naive
answers are both wrong:

| Naive assumption | Reality |
|---|---|
| `preBalances` is indexed by `getAccountKeys()` | It also excludes lookup-table keys — *not* true |
| `preBalances` is indexed by **static** keys only | Static **plus** loaded addresses — *not* true either |

The correct index space is:

```
staticAccountKeys ++ meta.loadedAddresses.writable ++ meta.loadedAddresses.readonly
```

Using static keys alone reports a zero delta for any SPL deposit in a transaction
that uses an address lookup table — which is common on modern Solana. That means
"payment not detected" and stranded funds, silently. Using the longer
`getAccountKeys()` list without the lookups reads the *wrong account's* balance.

`balanceIndexSpaceOf()` implements the correct space and `assertIndexSpace()`
turns any future divergence into a loud error rather than a silent zero.

`npm run test:chain` asserts this on real blocks every run, across legacy, v0
and v1 transaction shapes. It found this bug; reasoning alone did not.

### Transaction version

`MAX_TX_VERSION = 1`. Solana now emits **v1** transactions — roughly a quarter of
devnet traffic when measured. `maxSupportedTransactionVersion: 0` makes
`getTransaction` and `getBlock` fail outright, not degrade. Centralised as one
constant so it cannot drift.

---

## SPL payments watch the ATA

When someone sends USDC to an address, the token program moves value into that
address's **Associated Token Account** — a separate account. A naive
`getSignaturesForAddress(owner)` misses those transfers entirely.

`Order.depositAta` is derived at creation and the watcher scans it. The checkout
page shows the ATA for SPL and the owner address for SOL, with an explicit
warning, because this is the single most common way a customer loses money.

---

## Locked quotes

The crypto amount is computed at checkout and frozen for the order's TTL
(default 30 minutes).

You absorb the price risk; it is small and bounded. In exchange you never handle
"the price changed mid-payment", which is the largest single source of checkout
abandonment in crypto commerce. Customers get a QR code and a deep link with the
amount pre-filled, so mispayment is mostly designed out.

`PAYMENT_DUST_BPS` adds a small floor so a customer can never be one base unit
short through rounding. `PAYMENT_TOLERANCE_BPS` (150 = 1.5%) accepts small
shortfalls automatically — deliberate, because rounding across a blockchain
transfer should not cost someone a gift card.

---

## Idempotency everywhere

Three layers, because a double-issue costs real money from the issuer:

1. `PaymentTx.signature` is `UNIQUE` — a re-scan cannot double-credit.
2. `Fulfillment.externalId` is `UNIQUE` — a retried issuer call updates rather
   than creating a second set of codes.
3. `FeeAccrual.orderId` is `UNIQUE` — a retried fulfilment cannot book the fee
   twice.

Order creation accepts `Idempotency-Key`; the checkout derives one from a cart
fingerprint so a double-click or a retry returns the same order.

---

## Postgres for the job queue

No Redis, no BullMQ. One fewer moving part, and every enqueue happens inside the
same transaction as the state change that caused it — the **transactional outbox**
pattern.

If the process crashes mid-transaction, the job is never created *and* the state
change rolls back with it. You cannot end up "paid but never fulfilled", which is
the failure mode that actually costs money.

Claims use `FOR UPDATE SKIP LOCKED`, which is exactly what makes `FOR UPDATE`
safe across N workers: each row goes to exactly one.

Higher throughput? Swap the poll loop for `LISTEN/NOTIFY`. The claim SQL is
unchanged.

---

## Postgres for the fee pool

Rather than keeping a mutable running balance, fees are **accruals**: one row per
order, summed on demand. A running counter drifts when a transaction commits and
a later one retries; `SUM(...) WHERE sweepId IS NULL` cannot.

This makes reconciliation trivial — the fee is a pure function of the order —
and it means a failed sweep is recoverable by construction: detach the accruals
and retry the same money.

Sweeping uses dedicated HD slots (999000/999001) far above the deposit range, so
a sweeping transfer can never be mistaken for a customer deposit.

---

## Fees kept separate from merchant markup

`subtotalUsd` (face) → `lineTotalUsd` (+ merchant markup) → `platformFeeUsd`
(ours, 1%, on top).

If these were merged into one number, a merchant changing their margin would
change your revenue, changing your rate would rewrite historical orders, and a
partial refund could not return the correct fee. `platformFeeBps` is snapshotted
per order.

The atomic split uses `floor` with the remainder assigned to the merchant, so
`fee + merchant === total` exactly. Rounding the other way accumulates dust that
never sweeps.

---

## Multi-tenancy by host

Resolve order: `?tenant=` → custom domain → subdomain → house tenant.

Tenants share one global catalogue and override per product
(`TenantCatalogOverride`: hide, re-price, pin). Adding a merchant never means
duplicating 79 products, and no merchant can see another's pricing — the tenant
is resolved from the request on every call, including catalogue reads.

Theming is CSS custom properties injected server-side, so a rebranded store
renders its colours in the **first HTML byte** — no flash of default purple, no
client-side theme script.

The catalog is resolved on the server so the initial HTML already contains only
products legal for the visitor's market: no flash of an unavailable card, and no
wasted image fetches.

---

## Security decisions worth stating

**Codes encrypted at rest.** Gift-card codes are bearer instruments. Plaintext in
Postgres means one leaked backup or read-replica credential hands over real
value. AES-256-GCM with a key held outside the database, separate from
`WALLET_MASTER_KEY` so compromising one does not compromise the other.

**Wallet sign-in, not wallet connection.** Connecting proves nothing — anyone can
hand the app any address. A signed challenge proves key ownership without the
private key ever leaving the extension. The signed message is **reconstructed
server-side** from a single-use nonce, so a client cannot get us to verify an
arbitrary string (the classic message-confusion bug). Domain, URI (normalised),
cluster, issue time and expiry are all checked before the signature.

**Never `signTransaction` at login.** A frontend that can silently request
transaction signatures is a drainer waiting to happen. Login asks only for a free
message.

**Tracking tokens instead of emails in URLs.** `?email=` works but puts an
address into browser history, proxy logs and every `Referer` header. An opaque
token, stored only as a hash, does the same job.

**Order numbers are enumerable, so they are not authorisation.** Codes require
an exact email match or a tracking token.

**Crypto arithmetic.** `bigint` for lamports, `decimal.js` for USD, never a JS
`number`. Every atomic amount crosses the database as a decimal string.
`formatAtomic()` is the only place base units become human-readable.

---

## Trade-offs accepted

| Decision | Cost | Why it's still right |
|---|---|---|
| Quoted price frozen 30 min | Absorb adverse SOL moves | Bounded by TTL; removes an entire failure class |
| Poll the chain, don't subscribe | ~2.5s average detection | Stays under any RPC quota at scale; a subscription per address gives nothing extra |
| In-process rate limiter | Not global across nodes | Correct for one instance; one interface swap to Redis |
| Embedded Postgres for dev | Not for production | Removes the Docker prerequisite without changing the database |
| `scrypt` with N=2^15 per key derivation | ~80ms once per process | Memoised; negligible against a network round-trip |

---

## Failure behaviour

Every path that can lose a customer's money fails loudly instead of quietly.

| Situation | Behaviour |
|---|---|
| Issuer down | `FULFILL_ORDER` throws → retried with backoff; order stays `PAID`, never falsely `COMPLETED` |
| Codes issued, email fails | Codes shown inline on the order page; `emailSentAt` stays null; SLA monitor logs |
| Paid, not issued > 4 min | SLA monitor re-queues and `/api/health` reports `degraded` |
| Watcher restarts mid-scan | `PaymentTx.signature` UNIQUE makes re-processing a no-op |
| Sweep fails | Accruals detached, retried; revenue never silently lost |
| Partial payment | Order stays `PENDING_PAYMENT` with `underpaidUsd` set; another transfer to the same address is credited |
| RPC shape changes | `assertIndexSpace()` throws instead of mis-crediting |

The unifying principle: a failure should be visible in a log and on a dashboard
long before a customer notices it.