'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWallet, type WalletId } from './WalletProvider';
import { WALLETS, type WalletMeta } from './wallets';
import { walletConnectAvailable } from './walletconnect';
import { shortAddress } from '@solbazaar/core/client';

/**
 * Connect-wallet control.
 *
 * Flow: connect → sign a free, human-readable message → server verifies →
 * session cookie. Two steps on purpose — connecting alone proves nothing, and a
 * single click that both connects *and* signs is exactly the shape users are
 * trained to click through on malicious sites.
 *
 * The wallet list comes from `wallets.tsx`, so adding a wallet is a one-line
 * change there and this component picks it up: detection, mark, blurb, install
 * link and app hand-off all.
 */
export function ConnectWallet() {
  const { available, appOnly, address, session, connected, signingIn, error, walletName, connect, signIn, disconnect } =
    useWallet();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Read once at mount: the projectId is inlined at build time, so this cannot
  // change during the session.
  const [wcAvailable] = useState(() => walletConnectAvailable());

  /**
   * Split the catalogue three ways so the menu never lists something the user
   * cannot actually use at that moment:
   *   detected  → "Connect"
   *   installable → "Get" (a real extension they do not have yet)
   *   appOnly   → "Open app" (no in-page provider exists; be honest about it)
   */
  const groups = useMemo(() => {
    const detected: WalletMeta[] = [];
    const installable: WalletMeta[] = [];
    const apps: WalletMeta[] = [];
    for (const w of WALLETS) {
      if (w.id === 'walletconnect') continue; // rendered separately, see below
      if (available.includes(w.id)) detected.push(w);
      else if (appOnly.includes(w.id)) apps.push(w);
      else installable.push(w);
    }
    return { detected, installable, apps };
  }, [available, appOnly]);

  /*
   * WalletConnect sits apart from the other rows because it does not "connect"
   * the same way: there is no injected provider to call, it opens a QR/deep-link
   * pairing flow, and it is unavailable unless a projectId is configured. Giving
   * it its own section keeps that distinction legible instead of pretending it
   * behaves like Phantom.
   */
  const wc = WALLETS.find((w) => w.id === 'walletconnect')!;

  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // ── Signed in ──────────────────────────────────────────────────────────
  if (connected && session) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          className="btn btn-ghost h-10 sm:h-9 gap-2 !px-2.5 text-[13px]"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`Wallet ${shortAddress(session.address, 4, 4)}. Account menu`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: 'var(--ok)' }}
            aria-hidden
          />
          <span className="hidden font-mono font-semibold sm:inline">{shortAddress(session.address, 4, 4)}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {menu ? (
          <div
            role="menu"
            className="card absolute right-0 z-50 mt-2 w-72 overflow-hidden p-1.5 shadow-2xl"
            style={{ background: 'var(--surface)' }}
          >
            <div className="px-3 py-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--muted)]">
                Connected wallet
              </div>
              <code className="mt-1 block break-all font-mono text-[12px]">{session.address}</code>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden />
                Signed in on {session.chain}
              </div>
            </div>

            <a
              href={`https://solscan.io/account/${session.address}`}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex items-center gap-2 rounded-none px-3 py-2 text-[13px] hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]"
              role="menuitem"
            >
              View on Solscan
            </a>

            <button
              type="button"
              onClick={() => {
                setMenu(false);
                void disconnect();
              }}
              className="flex w-full items-center gap-2 rounded-none px-3 py-2 text-left text-[13px] hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]"
              role="menuitem"
            >
              Disconnect
            </button>

            <div className="border-t border-[var(--line)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
              Signing in only proved you control this address. It never gave us
              access to your funds — payments are always approved by you, in your
              own wallet.
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Connected but not signed in ────────────────────────────────────────
  if (address) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void signIn()}
          disabled={signingIn}
          className="btn btn-primary h-10 sm:h-9 !px-2.5 text-[13px]"
        >
          {signingIn ? 'Check wallet…' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={() => void disconnect()}
          className="btn btn-ghost h-10 sm:h-9 !px-2"
          aria-label="Disconnect wallet"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Not connected ──────────────────────────────────────────────────────
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        className="btn btn-ghost h-10 sm:h-9 gap-2 !px-2.5 text-[13px] font-semibold"
        aria-haspopup="menu"
        aria-expanded={menu}
      >
        <WalletGlyph />
        <span className="hidden sm:inline">Connect</span>
      </button>

      {menu ? (
        <div
          role="menu"
          className="card absolute right-0 z-50 mt-2 max-h-[min(80vh,40rem)] w-[21rem] overflow-y-auto p-1.5 shadow-2xl"
          style={{ background: 'var(--surface)' }}
        >
          {groups.detected.length ? (
            <Section title="Detected in this browser">
              {groups.detected.map((w) => (
                <Row
                  key={w.id}
                  wallet={w}
                  action="Connect"
                  onClick={() => {
                    setMenu(false);
                    void connect(w.id);
                  }}
                />
              ))}
            </Section>
          ) : (
            <div className="px-3 py-3">
              <p className="text-[13px] font-semibold">No wallet detected yet</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                Install any Solana wallet below, then reload this page. Wallets keep your
                key on your device — we never see it.
              </p>
            </div>
          )}

          {groups.installable.length ? (
            <Section title="More wallets">
              {groups.installable.map((w) => (
                <Row
                  key={w.id}
                  wallet={w}
                  action={w.appOnly ? 'Get app' : 'Get'}
                  href={w.appLink ?? w.site}
                />
              ))}
            </Section>
          ) : null}

          {groups.apps.length ? (
            <Section title="Mobile apps">
              {groups.apps.map((w) => (
                <Row key={w.id} wallet={w} action="Open app" href={w.appLink ?? w.site} />
              ))}
              <p className="px-3 pb-1 pt-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">
                These wallets sign inside their own app, so we hand you off rather than
                pretend a dialog is coming.
              </p>
            </Section>
          ) : null}

          {/*
           * WalletConnect, only when it is actually configured. Rendering a
           * "Connect" row that opens an error is worse than not offering it.
           */}
          {wcAvailable ? (
            <Section title="Any other wallet">
              <Row
                wallet={wc}
                action="Pair"
                onClick={() => {
                  setMenu(false);
                  void connect('walletconnect');
                }}
              />
              <p className="px-3 pb-1 pt-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">
                Scans a QR code with your phone, or opens your wallet directly. Works with
                mobile wallets that cannot sign inside a desktop browser tab.
              </p>
            </Section>
          ) : null}

          {error ? (
            <p
              className="mx-1.5 mb-1.5 mt-1 rounded-none px-2.5 py-2 text-[11.5px]"
              style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)' }}
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {/* Security note — this is a wallet product, so say it plainly. */}
          <div
            className="mx-1.5 mb-1 mt-1.5 rounded-none p-3"
            style={{ background: 'color-mix(in srgb, var(--ok) 9%, transparent)' }}
          >
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: 'var(--ok)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              We never ask for your key
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
              Connecting only reveals your public address. Signing in asks you to
              approve a free message — it cannot move funds. Sol Bazaar will never
              ask for your seed phrase.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </div>
      <div className="pb-1">{children}</div>
    </>
  );
}

/**
 * One wallet row.
 *
 * Renders as a button when the wallet is usable here, and as a link to the
 * official download when it is not — never as a button that opens a dialog which
 * cannot appear.
 */
function Row({
  wallet,
  action,
  onClick,
  href,
}: {
  wallet: WalletMeta;
  action: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      {wallet.mark}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold leading-tight">{wallet.label}</span>
        <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-[var(--muted)]">
          {wallet.blurb}
        </span>
      </span>
      <span className="shrink-0 text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
        {action}
      </span>
    </>
  );

  const className =
    'flex w-full items-center gap-2.5 rounded-none px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]';

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        role="menuitem"
        title={wallet.note ?? undefined}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} role="menuitem" title={wallet.note ?? undefined}>
      {inner}
    </button>
  );
}

function WalletGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6" />
      <path d="M16 13h.01" />
    </svg>
  );
}