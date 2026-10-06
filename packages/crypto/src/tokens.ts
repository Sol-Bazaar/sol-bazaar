/**
 * Token registry — which SPL mints we accept, at which decimals.
 *
 * Verify every mint address before shipping to mainnet: a wrong `decimals` value
 * makes every order's required amount off by 10^n and strands real funds.
 */
import type { TokenInfo, TokenSymbol } from './types';

export type { TokenSymbol } from './types';

export const TOKENS: Record<TokenSymbol, TokenInfo> = {
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    mint: null,
    explorer: 'solscan',
    fallbackUsd: 150,
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    // Circle USDC on Solana mainnet
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    explorer: 'solscan',
    fallbackUsd: 1,
  },
};

export const DEVNET_TOKENS: Partial<Record<TokenSymbol, TokenInfo>> = {
  // devnet USDC (Circle test mint) — 6 decimals
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin (devnet)',
    decimals: 6,
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    explorer: 'solana',
    fallbackUsd: 1,
  },
};

export function tokenInfo(symbol: TokenSymbol, isDevnet = false): TokenInfo {
  if (isDevnet && DEVNET_TOKENS[symbol]) return DEVNET_TOKENS[symbol]!;
  const t = TOKENS[symbol];
  if (!t) throw new Error(`Unsupported token: ${symbol}`);
  return t;
}

export function explorerUrl(sig: string, isDevnet: boolean): string {
  return isDevnet ? `https://explorer.solana.com/tx/${sig}?cluster=devnet` : `https://solscan.io/tx/${sig}`;
}

/** Alias used by fee-sweeping / accounting code where the intent is clearer. */
export const tokenExplorerUrl = explorerUrl;

export function addressExplorerUrl(addr: string, isDevnet: boolean): string {
  return isDevnet
    ? `https://explorer.solana.com/address/${addr}?cluster=devnet`
    : `https://solscan.io/account/${addr}`;
}