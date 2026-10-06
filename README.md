# Sol Bazaar

Lightweight gift card store with crypto payments (USDC on Solana) using Cryptorefills API.

## Features

- 🎁 **6,600+ brands** across 180+ countries via Cryptorefills
- 💰 **USDC on Solana** payments - instant, no price slippage
- 🔐 **WalletConnect** + Phantom/Solflare support
- 📦 **Zero prefunding** - pay per order in USDC
- 🚀 **Deploy to Vercel** in minutes
- 💎 **2% platform fee** built-in

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```

Fill in your credentials:
```env
# Cryptorefills (get from https://cryptorefills.com/api-docs)
CRYPTOREFILLS_API_KEY=your_api_key
CRYPTOREFILLS_WEBHOOK_SECRET=your_webhook_secret
CRYPTOREFILLS_API_BASE=https://api.cryptorefills.com

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta

# WalletConnect (get from https://cloud.reown.com)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id

# Your platform wallet (where 2% fees go)
PLATFORM_FEE_WALLET=your_solana_wallet_address
PLATFORM_FEE_BPS=200

# Wallet master seed (32 bytes hex or base58) - for HD wallet derivation
WALLET_MASTER_SEED=your_32_byte_seed_hex

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=GiftCard Store
```

### 3. Run locally
```bash
npm run dev
```

Open http://localhost:3000

### 4. Deploy to Vercel
```bash
vercel --prod
```

Add all environment variables in Vercel dashboard.

## Architecture

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx           # Homepage
│   ├── products/          # Product catalog
│   ├── product/[slug]/    # Product detail
│   ├── cart/              # Shopping cart
│   ├── checkout/          # Checkout flow
│   ├── order/[orderNumber]/ # Order confirmation
│   └── api/
│       ├── checkout/      # Create order
│       ├── webhooks/cryptorefills/ # Cryptorefills callbacks
│       ├── orders/verify-payment/  # Payment verification
│       └── auth/verify/   # SIWS authentication
├── components/            # React components
├── lib/
│   ├── catalog.ts         # Product catalog (mock)
│   ├── cryptorefills.ts   # Cryptorefills API client
│   ├── wallet.ts          # HD wallet + payment verification
│   ├── orders.ts          # Order management
│   └── tenant.ts          # Tenant config
└── globals.css            # Design system
```

## Payment Flow

1. **Customer adds cards to cart** → localStorage cart
2. **Checkout** → Email + create order → returns unique Solana deposit address
3. **Payment** → Customer sends USDC to deposit address (30 min window)
4. **Verification** → Poll Solana for payment → mark order PAID
5. **Fulfillment** → Call Cryptorefills API → get codes → email customer
6. **Complete** → Show codes on order page + email

## Cryptorefills Integration

### Sandbox Testing
1. Sign up at https://cryptorefills.com
2. Get API key from dashboard
3. Use sandbox credentials for testing

### Webhook Setup
Add webhook URL in Cryptorefills dashboard:
```
https://your-domain.vercel.app/api/webhooks/cryptorefills
```

Events to subscribe:
- `order.created`
- `order.paid`
- `order.completed`
- `order.failed`
- `order.expired`

## Wallet Generation

### Generate master seed
```bash
# Option 1: Generate 32-byte hex seed
openssl rand -hex 32

# Option 2: Use bip39 mnemonic (then convert to seed)
npx bip39-cli generate
```

Add to `WALLET_MASTER_SEED` in environment.

### HD Wallet Derivation
- Path: `m/44'/501'/{orderIndex}'/0'` (BIP-44 for Solana)
- Each order gets unique deposit address
- Platform fee wallet separate from deposit addresses

## Design System

Based on the "digivibe" aesthetic:
- Near-black background (`#0A090F`)
- Hairline grid background
- Square corners, bracket crop-marks
- Monospace labels with tabular numbers
- White accent (`#FFFFFF`) for primary actions
- Green (`#3BE06B`) for money amounts

## Scripts

```bash
npm run dev       # Development server
npm run build     # Production build
npm run start     # Production server
npm run lint      # ESLint
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `CRYPTOREFILLS_API_KEY` | Yes | API key from Cryptorefills |
| `CRYPTOREFILLS_WEBHOOK_SECRET` | Yes | Webhook verification secret |
| `CRYPTOREFILLS_API_BASE` | No | API base URL (default: https://api.cryptorefills.com) |
| `SOLANA_RPC_URL` | Yes | RPC endpoint (Helius/QuickNode recommended) |
| `SOLANA_CLUSTER` | No | `mainnet-beta` or `devnet` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes | Reown Cloud project ID |
| `PLATFORM_FEE_WALLET` | Yes | Your Solana wallet for 2% fees |
| `PLATFORM_FEE_BPS` | No | Platform fee in basis points (default: 200) |
| `WALLET_MASTER_SEED` | Yes | 32-byte seed for HD wallet |
| `NEXT_PUBLIC_APP_URL` | Yes | Your app URL |
| `NEXT_PUBLIC_APP_NAME` | No | Display name |

## Security Notes

- Never commit `.env.local` or `.env` files
- Use strong random seeds for `WALLET_MASTER_SEED`
- Rotate `CRYPTOREFILLS_WEBHOOK_SECRET` periodically
- Use hardware wallet for `PLATFORM_FEE_WALLET` in production
- Enable Vercel's WAF and rate limiting

## License

MIT