# Sol Bazaar

**White-label gift card storefront with Solana crypto payments.**

A complete, self-hostable platform: a geo-aware storefront, a partner REST API,
and non-custodial Solana payments with per-order deposit addresses.

---

## What you get

| Piece | What it does |
|---|---|
| **Storefront** | Next.js 15 landing page, catalogue, product pages, cart, checkout, live payment page |
| **White-label tenancy** | Every merchant gets their own subdomain (or custom domain), branding, pricing and margins |
| **REST API** | `/api/v1/*` — catalog, orders, fulfillment, webhooks. Scoped API keys, rate limited |
| **Geo-targeting** | Products filtered to the visitor's actual market, server-side, on every request |
| **Solana payments** | Per-order HD-derived deposit address, confirmation watcher, SPL + native SOL |
| **Gift card issuance** | Provider adapter (Recharge.com live, sandbox for dev) |
| **Platform fees** | 1% per item, tracked per order and **swept on-chain to your collector wallet** |
| **Security** | Codes encrypted at rest (AES-256-GCM), API keys scrypt-hashed, guest-checkout order gating |

---

## Quick start

```bash
git clone <your-repo> sol-bazaar && cd sol-bazaar

# 1. Install
npm install

# 2. Environment
cp .env.example .env

# 3. Generate the two encryption keys (prints values to paste into .env)
npm run keys:new

# 4. Start Postgres — Docker, or the zero-admin bundled server:
npm run db:up            # Docker
# npm run db:local start # no Docker required

# 5. Create the wallet (prints a one-time recovery mnemonic)
npm run wallet:new       # paste the encrypted WALLET_SEED it prints

# 6. Schema + catalogue
npm run db:generate
npm run db:push
npm run db:seed

# 7. Run
npm run dev
```

Then open:

- **Storefront** — http://localhost:3000
- **White-label partner** — http://localhost:3000?tenant=cryptocards
- **REST API** — http://localhost:3000/api/v1/catalog
- **Health** — http://localhost:3000/api/health

> Full step-by-step walkthrough, including devnet testing with real SOL:
> **[docs/SETUP.md](docs/SETUP.md)**

---

## How the crypto payment works

This is the part worth understanding before trusting it with money.

**1. Every order gets its own Solana address.**
The seed is derived at `m/44'/501'/{index}'/0'` (BIP-44 + SLIP-0010, hardened
because ed25519 cannot derive a child from a parent public key alone). Each
order receives the next unused index, allocated from a counter row under
`SELECT … FOR UPDATE` — never `max+1`, which two concurrent checkouts could
compute identically.

**2. That makes attribution exact.** Because no two orders share an address, an
incoming transaction belongs to exactly one order. No memo parsing, no
amount-hashing heuristics, no guessing.

**3. The amount is locked at checkout.** The customer sees "pay 0.0431 SOL" and
that stays true for the whole 30-minute window even if SOL moves 20%. You absorb
that exposure — it is small and bounded by the TTL — in exchange for never
having to handle "the price changed mid-payment", which is the single largest
source of checkout abandonment in crypto commerce.

**4. SPL payments watch the ATA, not the owner address.** When someone sends USDC
to an address, the token program moves value into that address's *Associated
Token Account* — a separate account. A naive `getSignaturesForAddress(owner)`
misses those transfers entirely and strands funds. The order stores `depositAta`
and the watcher scans both.

**5. Credits come from balance deltas, not instruction matching.** We compare
`preBalances`/`postBalances` and `preTokenBalances`/`postTokenBalances` for the
account's index. That is robust across every transfer shape: `transfer`,
`transferChecked`, CPI from another program, memo-carrying transfers.

**6. Fulfilment is blocked until the payment settles.** `fulfillOrder` refuses to
run unless the order is `PAID`. Shortfalls up to 1.5% are accepted
(`PAYMENT_TOLERANCE_BPS`); beyond that the order stays pending and the payment
page shows exactly what is still missing.

**7. Re-processing is impossible.** `PaymentTx.signature` is `UNIQUE` in
Postgres, so a watcher restart or two racing workers can never double-credit an
order.

---

## Design system

A technical-drawing aesthetic: near-black ground, a visible hairline grid, square
corners, crop-mark brackets on interactive cells, and monospaced micro-labels
with bracketed counts (`GAMING [10]`).

| Token | Value | Meaning |
|---|---|---|
| `--bg` | `#0A090F` | Near-black with a faint violet cast |
| `--surface` | `#0F0E15` | Panels |
| `--grid` | `#353539` | **Structural** grid lines — always visible |
| `--line` | `#22212B` | Borders on a single element |
| `--text` | `#EFEFE5` | Warm off-white; pure white reserved for emphasis |
| `--muted` / `--faint` | `#93948F` / `#5A5B5F` | Secondary / tertiary |
| `--accent` | `#FFFFFF` | Primary action — inverted button |
| `--money` | `#3BE06B` | Amounts. Colour here always means "this is a price" |
| `--cell` | `24px` | Grid cell, matched by the layout gutters |

**Why a grid instead of floating cards:** a gift-card grid is dozens of
third-party logos. Giving each one a filled, rounded card competes with the
logos themselves. Laying them on a shared hairline grid reads as one surface, so
the chrome recedes and the artwork carries the colour.

Type is **Outfit** (display) + **Roboto Mono** (everything utilitarian). The mono
is not decoration — half this interface is figures and identifiers, and a
proportional face makes columns of numbers ragged.

Two rules worth keeping:

- **Never `font-black`.** Medium weight with tight tracking reads as confident;
  heavy reads as loud and stops the logos being the loudest thing.
- **Every colour token comes from `themeStyle()`** in
  `packages/tenant/src/theme.ts`. Duplicating a hex value in `layout.tsx`
  silently overrides it — that bug shipped once and left light-mode tenants with
  the dark theme's borders.

### Country detection

The storefront detects the visitor's country automatically and prices in their
currency. Resolution order:

```
?country=XX → cookie → CDN geo header → IP lookup → tenant default
```

The first three are free and instant. **Put a CDN in front** — Cloudflare's free
tier is enough. It sets the country itself, so no third-party lookup ever runs.
The free IP-geo endpoints are rate-limited per *your server's* IP, and once they
start returning `429` every visitor silently falls back to the tenant default: a
German visitor sees US stock priced in dollars, with nothing logged as an error.
`getGeo()` emits `geo_detection_degraded` when that happens.

Providers are raced rather than sequenced, cached per IP for an hour, and paid
**once per visitor** because the result lands in a 30-day cookie.

Brand marks come from the Simple Icons CDN where a mark exists (~40 brands),
with a deterministic brand-coloured monogram as the fallback, so a blocked or
missing CDN degrades to a clean tile rather than a broken image.

### Brand assets

The logo ships in eight derived sizes, all generated from one source:

```bash
npm run brand:assets -- path/to/logo.png
```

Do not drop a logo into `public/` by hand. The pipeline exists because a typical
export is a 2000×2000 image with **no alpha channel** and ~40% dead margin:

| Output | Size | Used by |
|---|---|---|
| `public/brand/logo.png` | 899×1374 | Master, kept for regenerating the rest |
| `public/brand/logo-112.png` | 112px | Header lockup (2× the 28px slot) |
| `public/brand/favicon-{16,32,48}.png` | — | `<link rel=icon>` sizes |
| `app/icon.png` | 512px | Favicon |
| `app/apple-icon.png` | 180px | iOS home screen |
| `app/opengraph-image.png` | 1200×630 | OG / Twitter card, auto-injected |

The script refuses to run if the corners aren't a flat backdrop, because a trim
would otherwise silently clip the artwork.

**On the knockout maths:** the source *looks* white in every image viewer, but the
pixels are actually `(0,0,0)` — a black backdrop. Reading it as white inverts
every pixel and yields an invisible logo, which is why the script samples the
corners instead of trusting the preview. Against black, opacity is
`max(r,g,b)/255` and the un-premultiply normalises the brightest channel back to
255, so fully-opaque interior pixels come through bit-identical and only the
anti-aliased edges are touched.

Two things to know if you swap the artwork:

- The mark is **portrait** (899×1374). Render it sized by height with
  `width: auto`; a fixed square box letterboxes it to about half the size.
- It is the **only** colour on the page. The chrome is deliberately monochrome so
  the grid of third-party gift-card logos isn't competing with the brand — the
  mark carries all of it. If you'd rather lean into the purple, change
  `DEFAULT_BRAND.accent` in `packages/tenant/src/theme.ts` rather than hardcoding
  hexes.

---

## Local currency, USD settlement

Prices display in the **visitor's local currency**; the crypto amount is always
derived from the **USD total**.

That ordering is deliberate. If we derived SOL from the converted figure, a 2%
move between quote and payment would change what the customer owes. So the local
number is presentational, and the rate behind it is stated on the payment page:

> ≈ 23,39 € · converted from $26.25 at 1 SOL ≈ 121.04 USD

Rates: `FxRate` rows refreshed from the **ECB reference feed** (no API key), with
a static fallback so a cold database still renders a plausible price. Currencies
with no minor unit are handled — JPY shows `￥4,139`, not `￥4,139.00`.

`meta.display` in the catalogue API reports `currency`, `rate`, `isFallback` and
`fetchedAt`, so a partner never has to guess whether a rate is live.

---

## Wallets

Nine options, each detected honestly rather than optimistically:

| | |
|---|---|
| **Injected** | Phantom · Solflare · Backpack · Jupiter · Exodus · MetaMask |
| **WalletConnect** | 300+ wallets, incl. mobile ones that cannot sign in a desktop tab |
| **App hand-off** | Glow · Trust Wallet — labelled **"Open app"**, not "Connect" |

Detection is `window.phantom`/`solflare`/`backpack`/`jupiter`/`exodus`, then Wallet
Standard (`navigator.wallets`). Wallets that genuinely cannot sign in-page are
labelled "Open app" rather than offering a dialog that will never appear.

WalletConnect is **opt-in** — set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (free
from cloud.reown.com) or the option is hidden entirely. AppKit is ~340 packages
and lazy-loaded, so First Load JS stays ~105 kB.

Every path — injected or WalletConnect — uses the same Sign-In With Solana
challenge and the same server-side signature verification. Only `connect()` and
`signMessage()` are ever called.

**Why Solana only.** An ERC-20 transfer on Ethereum costs 25–150% of a low-value
gift card in gas (~$1.75 at 10 gwei against a $3.50 card), versus 0.02% on
Solana. That makes the low-value segment — most of this market — uneconomic
rather than more inclusive. If Ethereum is ever needed, an aggregator
(Banxa/Transak/Coinbase Commerce) converts a rewrite into a config change.

---

## Architecture

```
sol-bazaar/
├─ apps/
│  ├─ web/           Next.js 15 — storefront + REST API + admin
│  └─ worker/        Solana watcher · job runner · maintenance · fee sweeper
├─ packages/
│  ├─ core/          Money, geo, errors, rate limiting, fees, logging
│  ├─ db/            Prisma client, transactions, advisory locks
│  ├─ crypto/        HD wallet, RPC pool, deposit verification
│  ├─ provider/      Gift card issuer adapters (Recharge, sandbox)
│  ├─ tenant/        Host → tenant resolution, theming
│  ├─ jobs/          Postgres-backed job queue
│  └─ fulfillment/   Issuance, encrypted codes, email, webhooks
├─ prisma/           Schema + seed
└─ scripts/          Wallet, keys, local Postgres
```

Two processes, deliberately separated:

- **`web`** — stateless; scale horizontally behind a load balancer.
- **`worker`** — the latency-critical path. Split it further with
  `WORKER_ROLES=watcher,jobs,fees,maintenance` and scale each independently.

Job claims use `FOR UPDATE SKIP LOCKED`, and each worker role takes a Postgres
advisory lock, so running extra replicas is safe: the duplicate logs and skips.

---

## Platform fees

A **1% fee is charged on every order line**, on top of the merchant's markup, and
**swept on-chain to your collector wallet**:

```
EKCMKKGehtGp9UtYvAigogmbfBCHsSbMdMWLfsQNY8yZ
```

Three separate accounting layers, kept apart on purpose:

| Layer | Meaning |
|---|---|
| `subtotalUsd` | Face values after tier discounts |
| `lineTotalUsd` | Subtotal + **merchant** markup (what they earn) |
| `platformFeeUsd` | **Ours**, 1% of the line's value |

Why separate rather than merged:

- A merchant can set any margin without touching your revenue.
- `platformFeeBps` is **snapshotted per order**, so changing the rate never
  rewrites history.
- A refund returns exactly the fee charged on the refunded units.

**How fees move:**

1. Fulfilment completes → one `FeeAccrual` row (UNIQUE on `orderId`).
2. When the unswept balance crosses `PLATFORM_FEE_MIN_SWEEP_SOL`, the sweeper
   claims a batch of accruals, attaches them to a `FeeSweep`, and submits a real
   transfer from a dedicated HD slot (999000 / 999001 — far above the deposit
   range, so a sweep can never be mistaken for a customer deposit).
3. On confirmation the sweep is marked `CONFIRMED`. On failure the accruals are
   **detached again** and retried — nothing is lost, nothing is double-sent.

Fees accrue in whatever token the customer paid with and are swept in that same
token. USDC goes to the collector's associated token account, created on demand —
paying the collector's *owner* address with USDC would move nothing.

Batching matters: one sweep of 500 fees costs a single 5000-lamport signature
fee instead of 500 of them.

```bash
npm run worker -- src/fee-sweeper.ts --force   # sweep now
curl -H "Authorization: Bearer $OPERATOR_TOKEN" localhost:3000/api/admin/fees
```

---

## Multi-tenancy

Resolve order: `?tenant=` → custom domain → subdomain → house tenant.

```
solbazaar.com          → the platform's own store
acme.solbazaar.com     → merchant "acme"
gift.example.com        → merchant "acme" (custom domain via Domain table)
```

Tenants inherit a shared global catalogue and override per product
(`TenantCatalogOverride`: hide, re-price, pin). Adding a merchant never means
duplicating the catalogue.

Theming is CSS custom properties injected server-side, so a rebranded store
renders its colours in the **first HTML byte** — no flash of default purple, no
client-side theme script.

Create a tenant:

```bash
psql $DATABASE_URL -c "INSERT INTO \"Tenant\" (slug,name,status,baseDomain,defaultCountry,markupBps,\"minOrderUsd\",\"maxOrderUsd\",\"orderTtlMinutes\",\"acceptedTokens\",brand,theme,features,\"createdAt\",\"updatedAt\") VALUES ('acme','Acme Cards','ACTIVE','localhost:3000','US',700,5,1000,30,'{SOL}','{\"accent\":\"#22C55E\"}','{}','{}',now(),now()) RETURNING id;"
```

---

## Security notes

| Concern | Treatment |
|---|---|
| Gift card codes | AES-256-GCM at rest; key (`CODE_ENCRYPTION_KEY`) is **not** in the database |
| Wallet seed | AES-256-GCM; key (`WALLET_MASTER_KEY`) is **not** in the database |
| API keys | Only a scrypt hash stored; verified with `timingSafeEqual` |
| Order enumeration | Order numbers require a matching `?email=` |
| Issuer webhooks | HMAC-SHA256 verified against the raw body; **fails closed** in production |
| Stock oversell | Conditional `updateMany` guarded on available quantity |
| Fee misdirection | Sweeper refuses to run if `PLATFORM_FEE_WALLET` is not a valid Solana address |
| Money arithmetic | `bigint` for lamports, `decimal.js` for USD. Never JS `number` |

**Back up `WALLET_MASTER_KEY`, `CODE_ENCRYPTION_KEY` and the recovery mnemonic
separately.** Losing the wallet key means unreconciled deposits cannot be swept
or refunded. Losing the codes key means delivered codes can never be shown again.

---

## Scripts

```bash
npm run dev              # web + worker together
npm run dev:web          # storefront only
npm run dev:worker        # watcher + jobs + maintenance + fees

npm run db:up|db:down    # Postgres via Docker
npm run db:local start   # Postgres without Docker
npm run db:push          # sync schema (dev)
npm run db:migrate       # create a migration (prod)
npm run db:seed          # catalogue, tenants, admin

npm run keys:new         # generate encryption secrets
npm run wallet:new       # generate the operator wallet
npm run wallet:show      # show derived addresses (safe in prod)
npm run build            # production build
```

---

## Documentation

- **[docs/SETUP.md](docs/SETUP.md)** — step-by-step, devnet → mainnet
- **[docs/API.md](docs/API.md)** — REST reference with curl examples
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — design decisions and trade-offs
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — running it for real: sweeping, refunds, incidents