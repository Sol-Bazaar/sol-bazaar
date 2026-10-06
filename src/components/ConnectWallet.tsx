'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Wallet, Loader2, X, Check, AlertCircle } from 'lucide-react';
import bs58 from 'bs58';

const WALLET_CONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Extend Window interface for Solana wallet providers
declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      isSolflare?: boolean;
      connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
      signMessage: (message: Uint8Array, encoding: 'utf8' | 'hex') => Promise<{ signature: Uint8Array }>;
      publicKey: { toString(): string };
    };
  }
}

interface WalletState {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  signing: boolean;
  error: string | null;
}

export function ConnectWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    connected: false,
    connecting: false,
    signing: false,
    error: null,
  });
  const [showModal, setShowModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check for existing session
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          if (data?.address) {
            setState({ ...state, address: data.address, connected: true });
          }
        }
      } catch {
        // ignore
      }
    };
    checkSession();
  }, [state]);

  useEffect(() => {
    if (!showModal) return;
    const onClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) setShowModal(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowModal(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showModal]);

  const connect = async () => {
    if (!window.solana?.isPhantom && !window.solana?.isSolflare) {
      setState({ ...state, error: 'Please install Phantom or Solflare wallet' });
      return;
    }

    setState({ ...state, connecting: true, error: null });
    try {
      const provider = window.solana;
      const resp = await provider.connect({ onlyIfTrusted: false });
      const address = resp.publicKey.toString();

      // Sign a message for authentication
      const message = new TextEncoder().encode(
        `Sign in to GiftCard Store\n\nNonce: ${Date.now()}\nAddress: ${address}`
      );
      const signature = await provider.signMessage(message, 'utf8');

      // Send to server for session creation
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature: bs58.encode(signature.signature) }),
      });

      if (!res.ok) throw new Error('Authentication failed');

      setState({ ...state, address, connected: true, connecting: false, error: null });
      setShowModal(false);
    } catch (e) {
      setState({ ...state, connecting: false, error: (e as Error).message });
    }
  };

  const disconnect = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setState({ ...state, address: null, connected: false, error: null });
    setShowModal(false);
  };

  const shortAddr = (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  if (state.connected && state.address) {
    return (
      <div className="relative" ref={modalRef}>
        <button
          type="button"
          onClick={() => setShowModal((v) => !v)}
          className="btn btn-ghost h-10 sm:h-9 gap-2 !px-2.5 text-[13px]"
          aria-haspopup="menu"
          aria-expanded={showModal}
          aria-label={`Wallet ${shortAddr(state.address)}. Account menu`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--ok)' }} aria-hidden />
          <span className="hidden font-mono font-semibold sm:inline">{shortAddr(state.address)}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {showModal && (
          <div className="card absolute right-0 z-50 mt-2 w-72 overflow-hidden p-1.5 shadow-2xl" style={{ background: 'var(--surface)' }}>
            <div className="px-3 py-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--muted)]">Connected wallet</div>
              <code className="mt-1 block break-all font-mono text-[12px]">{state.address}</code>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden />
                Connected
              </div>
            </div>
            <a href={`https://solscan.io/account/${state.address}`} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 rounded-none px-3 py-2 text-[13px] hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]">
              View on Solscan
            </a>
            <button type="button" onClick={disconnect} className="flex w-full items-center gap-2 rounded-none px-3 py-2 text-left text-[13px] hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]">
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={modalRef}>
      <button
        type="button"
        onClick={() => setShowModal((v) => !v)}
        className="btn btn-ghost h-10 sm:h-9 gap-2 !px-2.5 text-[13px] font-semibold"
        aria-haspopup="menu"
        aria-expanded={showModal}
      >
        <Wallet className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Connect</span>
      </button>

      {showModal && (
        <div className="card absolute right-0 z-50 mt-2 w-80 overflow-hidden p-1.5 shadow-2xl" style={{ background: 'var(--surface)' }}>
          <div className="px-3 py-2.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--muted)]">Connect Wallet</div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
              We support Phantom and Solflare. Connecting only reveals your public address.
            </p>
          </div>

          {state.error ? (
            <div className="mx-1.5 mb-1.5 mt-1 rounded-none px-2.5 py-2 text-[11.5px]" style={{ background: 'color-mix(in srgb, var(--bad) 12%, transparent)', color: 'var(--bad)' }} role="alert">
              <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
              {state.error}
            </div>
          ) : null}

          <div className="space-y-2">
            {[
              { id: 'phantom', name: 'Phantom', icon: '👻', check: 'window.solana?.isPhantom' },
              { id: 'solflare', name: 'Solflare', icon: '🔥', check: 'window.solana?.isSolflare' },
            ].map((w) => {
              const available = eval(w.check);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={connect}
                  disabled={!available || state.connecting}
                  className="flex w-full items-center gap-3 rounded-none px-3 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_75%,transparent)]"
                  style={{ opacity: available ? 1 : 0.5 }}
                >
                  <span className="text-[20px]" aria-hidden>{w.icon}</span>
                  <div className="flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{w.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                      {available ? 'Available' : 'Not installed'}
                    </span>
                  </div>
                  {state.connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              );
            })}
          </div>

          <div className="border-t border-[var(--line)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
            Connecting only reveals your public address. Signing in asks you to approve a free message — it cannot move funds.
          </div>
        </div>
      )}
    </div>
  );
}