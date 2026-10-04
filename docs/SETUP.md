# Setup — step by step

From a clean machine to a working store. Tested on Windows / Node 24; the same
commands work on macOS and Linux.

---

## 0. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20.11 | `winget install OpenJS.NodeJS.LTS` |
| PostgreSQL | 15+ | Docker, the bundled server, or any host |
| Optional | — | A Solana RPC provider (Helius / QuickNode) for mainnet |

```bash
node --version    # v20.11 or newer
npm --version
```

---

## 1. Get the code

```bash
git clone <your-repo-url> sol-bazaar
cd sol-bazaar
npm install
```

> **Windows PowerShell:** `npm` may resolve to `npm.ps1`, which is blocked by the
> default execution policy. Use `npm.cmd` instead, or run commands from `cmd`.

---

## 2. Environment

```bash
cp .env.example .env     # Windows: copy .env.example .env
```

The defaults are tuned for local development and will run as-is.

### 2.1 Generate the two encryption keys

```bash
npm run keys:new
```

Paste both values into `.env`:

```dotenv
WALLET_MASTER_KEY="<64 hex chars>"
CODE_ENCRYPTION_KEY="<64 hex chars>"
```

| Variable | Encrypts | If you lose it |
|---|---|---|
| `WALLET_MASTER_KEY` | the wallet seed, webhook secrets | Unreconciled deposits can't be swept or refunded |
| `CODE_ENCRYPTION_KEY` | redeemable gift-card codes at rest | Delivered codes can never be shown again |

Keep them **separate from each other and from the database**, and back them up
offline. Run `keys:new` exactly once — re-running does not rotate anything.

---

## 3. Database

Either works; pick one.

**Docker**

```bash
npm run db:up        # postgres on :5432
```

**No Docker** — a real PostgreSQL 17 server from bundled binaries:

```bash
npm run db:local -- start
npm run db:local -- status
npm run db:local -- stop
```

Then:

```bash
npm run db:generate   # regenerate the Prisma client from the schema
npm run db:push       # create tables
```

---

## 4. Operator wallet

```bash
npm run wallet:new
```

This prints a **12/24-word recovery mnemonic once** plus an encrypted envelope.
Save the mnemonic offline, then paste the envelope into `.env`:

```dotenv
WALLET_SEED="v1.<salt>.<iv>.<tag>.<ciphertext>"
```

> The mnemonic is shown exactly once. Anyone holding it can sweep every deposit
> address this platform will ever issue.

Confirm it loaded:

```bash
npm run wallet:show
```

---

## 5. Catalogue

```bash
npm run db:seed
```

Creates 17 categories, ~79 products with denominations and stock, two demo
tenants (to prove white-labelling), an admin user and token prices.

```
admin login: admin@solbazaar.com / ChangeMe123!
```

Change that immediately — `SEED_ADMIN_PASSWORD` on the next seed, or update the
row directly.

---

## 6. Run

```bash
npm run dev
```

| Surface | URL |
|---|---|
| Storefront | http://localhost:3000 |
| White-label partner | http://localhost:3000?tenant=cryptocards |
| Catalogue API | http://localhost:3000/api/v1/catalog |
| Health | http://localhost:3000/api/health |

---

## 7. Test a full purchase

### 7.1 With the sandbox issuer (no funds needed)

The sandbox provider issues instantly, so you can exercise the whole pipeline —
including code delivery — without crypto or an issuer account.

1. Open http://localhost:3000/products
2. Add any card → **Checkout**
3. Enter an email address (required — codes go there)
4. Copy the deposit address from the order page
5. **Simulate** a settled payment instead of sending real SOL:

```bash
node -e "
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
(async()=>{
  const o=await p.order.findFirst({where:{status:'PENDING_PAYMENT'},orderBy:{createdAt:'desc'}});
  if(!o) return console.log('no pending order');
  await p.\$transaction([
    p.paymentTx.create({data:{orderId:o.id,signature:'sim_'+Date.now(),slot:1,atomicAmount:o.expectedAtomic,direction:'IN',confirmations:32,finalized:true}}),
    p.order.update({where:{id:o.id},data:{status:'PAID',paidAt:new Date(),receivedAtomic:o.expectedAtomic,confirmations:32}}),
  ]);
  console.log('marked paid:',o.orderNumber);
  await p.\$disconnect();
})();
"
```

6. The worker picks it up within a second or two:
   - detects the credit, marks the order `PAID`
   - calls the issuer → codes are encrypted and stored
   - emails them and shows them inline on the order page
   - books the 1% platform fee for sweeping

Check `/api/health` — `deliverySla.paidNotIssued` should return to 0.

---

## 8. Testing with real devnet SOL

Set up a wallet you control:

```bash
node -e "
const {SolanaHdWallet}=require('./packages/crypto/src/hd-wallet.ts');
" 2>/dev/null
```

Simpler: use the operator wallet you already created.

```bash
# 1. Fund it on devnet: https://faucet.solana.com  (paste slot 0 from `npm run wallet:show`)
# 2. Point .env at devnet
SOLANA_CLUSTER=devnet
```

```bash
npm run wallet:show     # note slot 0
```

Place an order, then send the exact amount from slot 0 to the order's deposit
address. Within ~5 seconds the watcher detects it and the flow completes.

Verify the parser against live chain data at any time:

```bash
npm run test:chain -- --blocks 5
```

This checks the balance-delta logic against real transactions — including
legacy, v0 and **v1** transaction shapes and address-lookup-table transactions.
It exists because a wrong delta either issues an unpaid gift card or reports "no
payment" and strands funds, and both failures are silent.

---

## 9. Going to mainnet

Work through this in order. Steps 1–4 are where mistakes cost money.

### 9.1 RPC

Public endpoints will rate-limit you and are not acceptable for real funds.

```dotenv
SOLANA_CLUSTER=mainnet-beta
SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..."
# Multiple URLs = automatic failover across the pool:
SOLANA_RPC_URLS="https://mainnet.helius-rpc.com/?api-key=...,https://api.mainnet-beta.solana.com"
```

### 9.2 A fresh wallet

```bash
npm run wallet:new
```

Verify the derived deposit addresses before accepting a single payment.

### 9.3 Confirm the fee collector

```dotenv
PLATFORM_FEE_WALLET=EKCMKKGehtGp9UtYvAigogmbfBCHsSbMdMWLfsQNY8yZ
```

A typo here sends real revenue to an address nobody controls, and it is
irreversible. The sweeper refuses to run if the value is not a valid Solana
address — but that check cannot tell you it is the *wrong* valid address.

### 9.4 Real gift cards

```dotenv
RECHARGE_API_KEY=...
RECHARGE_WEBHOOK_SECRET=...
PROVIDER_REQUIRE_REAL=true
EMAIL_PROVIDER=resend
EMAIL_API_KEY=...
EMAIL_FROM="Your Store <orders@yourdomain.com>"
```

Then verify field mapping against Recharge's current docs — the adapter is
written against their v1 shape, which has changed before (`sku` was added,
`denominations` became `prices`, `gift_card.code` moved).

Point Recharge's webhook at:

```
https://yourdomain.com/api/v1/webhooks/issuer/recharge
```

Sync the live catalogue (this replaces the seeded products and availability with
whatever the issuer reports):

```bash
npm run db:seed -- --sync     # or POST /api/admin/catalog/sync
```

### 9.5 Harden

```dotenv
NODE_ENV=production
APP_URL="https://yourdomain.com"
BASE_DOMAIN="yourdomain.com"
REQUIRE_FINALIZED=true          # keep it on
PAYMENT_TOLERANCE_BPS=0         # demand exact payment if you prefer
OPERATOR_TOKEN=<openssl rand -hex 32>
```

- Replace all secrets in `.env`; commit nothing.
- Put the app behind HTTPS (HSTS is already sent).
- Run `npm run db:migrate` instead of `db:push` for real deployments.
- Scale `web` and `worker` separately; split the worker with
  `WORKER_ROLES=watcher,jobs,fees,maintenance`.

### 9.6 Backups

Back up the database **and** these three things, stored apart from each other:

1. `WALLET_MASTER_KEY`
2. `CODE_ENCRYPTION_KEY`
3. The wallet recovery mnemonic

Losing (3) orphans every deposit address. Losing (2) means a customer who already
paid can never see their codes again.

---

## 10. Enabling WalletConnect

WalletConnect is **off by default**. It needs a free projectId, and rendering a
"Connect" option that opens an error is worse than not offering it.

1. Sign up at <https://cloud.reown.com> and create a project.
2. Copy the **projectId** (a public client value, not a secret).
3. Add it to `.env`:

```dotenv
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

4. Rebuild. `NEXT_PUBLIC_*` values are inlined into the client bundle **at build
   time**, so a change needs a fresh `npm run build` before `next start` sees it.

Without it the list shows Phantom, Solflare, Backpack, Jupiter, Exodus, MetaMask,
Glow and Trust Wallet, and the WalletConnect section is omitted entirely.

### What it does and does not do

AppKit is pinned to **one** CAIP network id (mainnet or devnet, from
`SOLANA_CLUSTER`). Pinning is deliberate: a wallet on the wrong chain should fail
loudly rather than be silently quoted for a deposit that never arrives.

A connected WalletConnect wallet goes through the **same Sign-In With Solana
flow** as an injected Phantom — identical challenge, identical server-side
signature verification, one code path to audit. Only `connect()` and
`signMessage()` are ever called; there is no code path from the wallet layer to
`signTransaction` outside the customer's own payment approval.

AppKit is ~340 packages, `import()`ed **on demand**, so it lives in its own lazy
chunk. First Load JS is unaffected (~105 kB shared).

---

## 11. ⚠️ Where `.env` has to live

Next.js only auto-loads `.env*` from **its own working directory**, which in this
monorepo is `apps/web`. Our env file lives at the **repo root** because the
worker, Prisma and the scripts all share it.

`apps/web/next.config.ts` therefore loads it explicitly:

```ts
loadEnvFile({ path: path.resolve(process.cwd(), '../../.env') });
```

**Do not remove that line.** Without it Next sees none of the config and every
lookup silently falls back to a hardcoded default — and because the defaults
happen to match development values, it looks like it is working.

The tell: a `NEXT_PUBLIC_*` variable that has no effect on the client means the
file was never loaded. Those values are inlined at build time from Next's own
environment, so they cannot be fixed at runtime.

`dotenv` does not overwrite already-set variables, so a real deployment that
supplies its own environment still wins.

---

## 12. Local currency pricing

Prices are quoted in the **visitor's local currency**; settlement stays in
**USD**. The customer sees `24,15 €`, and the crypto amount is always derived
from the USD total.

That ordering is the whole point. If we instead derived SOL from the converted
amount, a 2% move between quote and payment would change what the customer owes.
The local figure is presentational, and the rate behind it is stated on screen.

Rates come from `FxRate` rows, refreshed by the worker from the **ECB reference
feed** (no API key, once daily). With no rate available, `FALLBACK_RATES` in
`packages/core/src/fx.ts` is used and the API reports `isFallback: true` so a
partner can tell a stale rate from a live one.

```bash
# refresh by hand
npx tsx -e "import 'dotenv/config'; import { refreshFxRates } from './apps/worker/src/maintenance'; await refreshFxRates();"
```

The worker does this on its maintenance loop, at most once every 6 hours.

---

## 13. Country / region detection

The storefront detects the visitor's country automatically and prices the
catalogue in their currency. Resolution order:

```
?country=XX  →  fc_country cookie  →  CDN geo header  →  IP lookup  →  tenant default
```

The first three are free and instant. The fourth costs one HTTP request.

### Put a CDN in front — seriously

Behind **Cloudflare, Vercel, Fly or CloudFront** the CDN sets the country itself
(`cf-ipcountry`, `x-vercel-ip-country`, `fly-client-country`,
`cloudfront-viewer-country`) and **no third-party lookup ever happens**. The IP
lookup exists for self-hosted deployments with no geo header.

This is not just tidiness. The free IP-geo endpoints are community-funded and
rate-limited per calling IP — your server's IP, not the visitor's. A storefront
doing meaningful traffic will accumulate lookups against one quota and start
getting `429`s, at which point every visitor silently falls back to the tenant
default: a German visitor sees US stock priced in dollars, with no error anywhere.

Cloudflare's free tier is enough and takes about five minutes to set up.

### Tuning

```dotenv
GEO_IP_LOOKUP=true           # false disables IP lookup entirely
GEO_LOOKUP_TIMEOUT_MS=2500  # worst-case budget; providers are raced
DEFAULT_COUNTRY=US          # last-resort fallback
```

Providers (`ipwho.is`, `api.country.is`, `ip-api.com`) are **raced, not
sequenced** — the answer arrives as soon as the fastest replies, and a slow or
rate-limited one costs only a wasted request. Measured latency on these has
ranged from 0.6s to 3.4s for the same query, so the default budget is 2.5s; raise
it if detection feels unreliable, lower it if you have a CDN.

Results are cached per IP for an hour (failures for a minute, so a downed
provider is not retried on every render), and the detected country is written to
the `fc_country` cookie for 30 days. So this cost is paid **once per visitor**.

### Knowing when it breaks

`getGeo()` logs whenever detection was not free:

```json
{"msg":"geo_detected","country":"DE","source":"ip","ms":0}
{"msg":"geo_detection_degraded","country":"US","source":"tenant",
 "hint":"no geo header and IP lookup did not resolve — put a CDN in front…"}
```

If you see `geo_detection_degraded` in production, detection is not working and
visitors are seeing the wrong market. That is the signal to watch.

---

## 14. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `WALLET_SEED is neither an encrypted envelope…` | Envelope present but `WALLET_MASTER_KEY` missing/mismatched | Re-run `keys:new`, restore the correct master key |
| `No tenant could be resolved for host` | Database empty or `BASE_DOMAIN` wrong | `npm run db:seed`; check `BASE_DOMAIN` |
| Order stuck `PENDING_PAYMENT` | No worker running | `npm run dev:worker` |
| `paidNotIssued > 0` on `/api/health` | Issuer slow/down, or queue stalled | Check issuer API; the worker re-queues automatically |
| Codes not emailed | No `EMAIL_API_KEY` | Codes are still on the order page; set the key |
| `429` from Solana RPC | Public endpoint | Move to a dedicated provider |
| `Transaction version (1) is not supported` | Solana shipped v1 transactions | Set `MAX_TX_VERSION = 1` in `packages/crypto/src/connection.ts` |
| Build fails with `node:crypto` in a Client Component | Server-only import in client code | Import from `@solbazaar/core/client` |