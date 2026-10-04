'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCart } from './CartProvider';
import { useWallet } from './WalletProvider';
import { shortAddress } from '@solbazaar/core/client';

export interface CheckoutTokens {
  /** Client symbols accepted by this store, e.g. ['SOL','USDC']. */
  accepted: string[];
  /** Server-computed totals. The client NEVER computes these. */
  totalsByToken: Record<string, { amount: string; symbol: string; mint: string | null; decimals: number }>;
}

/**
 * Pre-check: confirm the connected wallet holds enough to cover the order.
 *
 * ── Advisory, not authoritative ────────────────────────────────────────────
 * The server re-prices every line and derives the required amount inside the
 * order transaction. A tampered client cannot change what is charged, and a
 * wallet balance can change between this check and the payment. So this gate
 * improves the experience (fail fast, tell the customer to top up) and is never
 * the thing that decides whether an order is valid.
 *
 * It also cannot be bypassed: the checkout server action re-validates email and
 * quotes its own amounts regardless of what this component reports.
 */
export function BalanceCheck({ tokens }: { tokens: CheckoutTokens }) {
  const { lines, subtotalUsd, hydrated } = useCart();
  const { address, session, balance, balanceLoading, balanceError, refreshBalance } = useWallet();

  const primary = tokens.accepted[0] ?? 'SOL';
  const quote = tokens.totalsByToken[primary];

  // Refresh the balance whenever the wallet or the cart changes.
  useEffect(() => {
    if (!address) return;
    void refreshBalance(
      tokens.accepted.map((sym) => {
        const q = tokens.totalsByToken[sym];
        return { mint: q?.mint ?? null, decimals: q?.decimals ?? 9 };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokens.accepted.join(','), subtotalUsd.toFixed(2)]);

  if (!hydrated) return null;

  const required = quote ? Number(quote.amount) : 0;
  const held = balance?.amount ?? 0;
  const enough = held >= required;
  const missing = Math.max(0, required - held);

  if (!session) {
    return (
      <Panel
        tone="info"
        title="Connect your wallet"
        body="Connect and sign in to check your balance before paying. This is optional — you can also pay from any wallet or exchange."
      >
        <a href="#connect-wallet" className="text-[12px] font-semibold underline underline-offset-4" style={{ color: 'var(--accent)' }}>
          Use the Connect button in the header ↑
        </a>
      </Panel>
    );
  }

  return (
    <div
      className="rounded-none border p-3.5"
      style={{
        borderColor: balanceLoading
          ? 'var(--line)'
          : enough
            ? 'color-mix(in srgb, var(--ok) 40%, transparent)'
            : 'color-mix(in srgb, var(--warn) 45%, transparent)',
        background: balanceLoading
          ? 'color-mix(in srgb, var(--bg) 45%, transparent)'
          : enough
            ? 'color-mix(in srgb, var(--ok) 8%, transparent)'
            : 'color-mix(in srgb, var(--warn) 9%, transparent)',
      }}
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {balanceLoading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin text-[var(--muted)]">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity=".25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </svg>
          ) : enough ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-bold">Wallet balance</span>
            <span className="font-mono text-[12.5px] font-bold tabular-nums">
              {balanceLoading ? '…' : `${held.toFixed(held < 1 ? 6 : 4)} ${primary}`}
            </span>
          </div>

          <div className="mt-1 flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-[var(--muted)]">Needed for this order</span>
            <span className="font-mono tabular-nums">
              {required.toFixed(required < 1 ? 6 : 4)} {primary}
            </span>
          </div>

          <p className="mt-1.5 font-mono text-[11px] text-[var(--muted)]">
            {shortAddress(session.address, 6, 6)}
          </p>

          {!enough && !balanceLoading ? (
            <p className="mt-2 text-[12px] font-medium" style={{ color: 'var(--warn)' }} role="alert">
              Short by {missing.toFixed(missing < 1 ? 6 : 4)} {primary}. Add funds to this wallet, or pay
              from a different wallet — we will give you a fresh address either way.
            </p>
          ) : null}

          {enough && !balanceLoading ? (
            <p className="mt-2 text-[12px]" style={{ color: 'var(--ok)' }}>
              Enough to cover this order. Keep the balance available until the payment confirms — a few
              seconds on Solana.
            </p>
          ) : null}

          {balanceError ? (
            <p className="mt-2 text-[11.5px] text-[var(--muted)]">
              Could not read your balance ({balanceError}). You can still continue — we will give you a
              payment address and check it on-chain.
            </p>
          ) : null}

          {!lines.length ? null : (
            <p className="mt-2 text-[11px] leading-relaxed text-[color-mix(in_srgb,var(--muted)_80%,transparent)]">
              Balance is read from the public Solana network and is only a hint. The amount you must send is
              fixed when the order is created, and we verify it on-chain before issuing your card.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({
  tone,
  title,
  body,
  children,
}: {
  tone: 'info';
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-none border p-3.5"
      style={{ borderColor: 'var(--line)', background: 'color-mix(in srgb, var(--bg) 45%, transparent)' }}
    >
      <div className="text-[13px] font-bold">{title}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{body}</p>
      {children ? <div className="mt-2">{children}</div> : null}
      <span className="sr-only">{tone}</span>
    </div>
  );
}