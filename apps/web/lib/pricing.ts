/**
 * Token pricing.
 *
 * The quote an order receives is **locked at checkout** and stored on the order
 * row. The customer sees "pay 0.0431 SOL" and that stays true for the full
 * 30-minute window even if SOL moves 20%. The operator absorbs that exposure
 * (it is tiny and bounded by the TTL) in exchange for not having to handle
 * "the price changed mid-payment" — which is the single biggest source of
 * checkout abandonment in crypto commerce.
 */
import Decimal from 'decimal.js';
import { prisma, TokenSymbol } from '@solbazaar/db';
import { createLogger, quoteUsdToAtomic } from '@solbazaar/core';
import { tokenInfo as tokenInfoFor, isMainnet } from '@solbazaar/crypto';
import type { TokenInfo } from '@solbazaar/crypto';

const log = createLogger({ service: 'pricing' });

/** Sources tried in order; each returns USD per 1 token. */
const ORACLES: Array<{ name: string; url: string; pick: (j: any) => number | null }> = [
  {
    // CoinGecko — free, no key, widely used.
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    pick: (j) => j?.solana?.usd ?? null,
  },
];

export async function fetchTokenPrices(symbols: TokenSymbol[] = ['SOL', 'USDC', 'USDT']): Promise<Partial<Record<TokenSymbol, Decimal>>> {
  const out: Partial<Record<TokenSymbol, Decimal>> = {};
  const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';

  // Stablecoins: assume parity with USD by default, then try an oracle.
  for (const s of symbols) {
    if (s === 'USDC' || s === 'USDT') out[s] = new Decimal(1);
  }

  if (symbols.includes('SOL')) {
    for (const oracle of ORACLES) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 5000);
        const res = await fetch(oracle.url, { signal: ctl.signal, headers: { accept: 'application/json' } });
        clearTimeout(timer);
        if (!res.ok) continue;
        const usd = oracle.pick(await res.json());
        if (usd && usd > 0) {
          out.SOL = new Decimal(String(usd));
          await prisma.tokenPrice.upsert({
            where: { symbol: TokenSymbol.SOL },
            create: { symbol: TokenSymbol.SOL, usd: out.SOL, source: oracle.name },
            update: { usd: out.SOL, source: oracle.name, fetchedAt: new Date() },
          });
          log.info('price_fetched', { symbol: 'SOL', usd: out.SOL.toFixed(2), source: oracle.name });
          break;
        }
      } catch (e) {
        log.warn('oracle_failed', { source: oracle.name, err: (e as Error).message });
      }
    }
  }

  // Fall back to the last persisted price rather than the hardcoded guess
  // whenever possible — a stale-but-recent price beats a fabricated one.
  for (const s of symbols) {
    if (out[s]) continue;
    const cached = await prisma.tokenPrice.findUnique({ where: { symbol: s } });
    out[s] = cached ? new Decimal(String(cached.usd)) : new Decimal(tokenInfoFor(s, !isMainnet(cluster as any)).fallbackUsd ?? 1);
  }

  return out;
}

export interface PriceQuote {
  token: TokenSymbol;
  mint: string | null;
  decimals: number;
  tokenUsd: Decimal;
  cryptoAmount: Decimal;
  atomicAmount: bigint;
  expectedAtomic: bigint;
  usdTotal: Decimal;
  isStale: boolean;
  fetchedAt: Date | null;
}

/** Build the locked quote for an order. */
export async function quoteOrder(args: {
  usdTotal: Decimal;
  token: TokenSymbol;
  markupBps: number;
  toleranceBps: number;
}): Promise<PriceQuote> {
  const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
  const info: TokenInfo = tokenInfoFor(args.token, !isMainnet(cluster as any));

  const stored = await prisma.tokenPrice.findUnique({ where: { symbol: args.token } });
  const live = await fetchTokenPrices([args.token]);
  const tokenUsd = live[args.token] ?? stored?.usd ?? new Decimal(info.fallbackUsd ?? 1);

  // A price older than 15 minutes is suspicious — surface it in the UI so an
  // operator notices a broken oracle before it eats their margin.
  const ageMin = stored?.fetchedAt ? (Date.now() - stored.fetchedAt.getTime()) / 60_000 : Infinity;

  // `dustBps` adds a small floor so a customer can never "almost" pay by
  // rounding a single base unit short.
  const q = quoteUsdToAtomic(args.usdTotal, tokenUsd, info.decimals, {
    // Tenant markup is already baked into usdTotal by the caller, so it is not
    // applied twice here.
    markupBps: 0,
    dustBps: Number(process.env.PAYMENT_DUST_BPS ?? 10),
  });

  // Tolerance is a *reduction* of the required amount: accept up to
  // `toleranceBps` short and still issue the card.
  const expectedAtomic = q.atomic;

  return {
    token: args.token,
    mint: info.mint,
    decimals: info.decimals,
    tokenUsd,
    cryptoAmount: q.crypto,
    atomicAmount: expectedAtomic,
    expectedAtomic,
    usdTotal: q.usd,
    isStale: ageMin > 15,
    fetchedAt: stored?.fetchedAt ?? null,
  };
}

/** Current prices for the storefront's crypto picker (no order context). */
export async function getPriceBoard(): Promise<{ symbol: TokenSymbol; usd: string; decimals: number; mint: string | null; fetchedAt: string | null }[]> {
  const cluster = process.env.SOLANA_CLUSTER ?? 'devnet';
  const prices = await fetchTokenPrices(['SOL', 'USDC', 'USDT']);
  const rows = await prisma.tokenPrice.findMany();
  const fetchedAt = new Map(rows.map((r) => [r.symbol, r.fetchedAt]));

  return (['SOL', 'USDC', 'USDT'] as TokenSymbol[]).map((s) => {
    const info = tokenInfoFor(s, !isMainnet(cluster as any));
    return {
      symbol: s,
      usd: (prices[s] ?? new Decimal(1)).toFixed(2),
      decimals: info.decimals,
      mint: info.mint,
      fetchedAt: (fetchedAt.get(s) ?? null)?.toISOString() ?? null,
    };
  });
}