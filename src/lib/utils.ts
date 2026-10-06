import Decimal from 'decimal.js';

export function formatUsd(value: number | string | Decimal): string {
  const d = new Decimal(value);
  return d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCrypto(value: string | number | Decimal, decimals: number): string {
  const d = new Decimal(value);
  const fixed = d.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '');
}

export function shortAddress(address: string, start = 4, end = 4): string {
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}