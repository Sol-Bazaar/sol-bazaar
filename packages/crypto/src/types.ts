/** Shared crypto-side types (kept dependency-free so this package stays lean). */
export type TokenSymbol = 'SOL' | 'USDC';

export interface TokenInfo {
  symbol: TokenSymbol;
  name: string;
  decimals: number;
  /** null => native SOL */
  mint: string | null;
  explorer: 'solscan' | 'solana';
  fallbackUsd?: number;
}