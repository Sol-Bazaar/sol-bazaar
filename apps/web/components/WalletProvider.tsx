'use client';

/**
 * Wallet connection + sign-in, and read-only balance checks.
 *
 * ── What we ask the wallet for ───────────────────────────────────────────────
 *   `connect()`        → returns a public address. No prompt on most wallets.
 *   `signMessage()`    → user reads the message and approves. Free, no gas,
 *                        cannot move funds.
 *
 * ── What we NEVER ask for, and why ───────────────────────────────────────────
 *   `request({signTransaction})` at any point outside the customer's own payment
 *   flow. A frontend that can silently request transaction signatures is a
 *   drainer waiting to happen, so the only place we ever build a transaction is
 *   the payment instruction shown to the user, which they approve in their own
 *   wallet with the amount spelled out.
 *   Private keys or seed phrases. There is no code path for it and no UI for it.
 *
 * ── Balance reads are advisory only ──────────────────────────────────────────
 * Balances are fetched from public RPC for display. The server never trusts
 * them: it re-prices every line and computes the required amount itself. A
 * tampered client cannot change what is charged.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  generateNonce,
  parseSignInMessage,
  shortAddress,
  SESSION_TTL_MS,
} from '@solbazaar/core/client';
import { WALLETS, findProvider, detectWallets, type SolanaProvider, type WalletId } from './wallets';

export type { SolanaProvider, WalletId };

export interface WalletSession {
  address: string;
  chain: string;
  expiresAt: string;
}

export interface TokenBalance {
  mint: string;
  amount: number;
  decimals: number;
}

interface WalletContextValue {
  /**
   * Wallets with a usable injected provider in this browser. Ordered as the
   * catalogue lists them, not by probe order, so the UI is stable.
   */
  available: WalletId[];
  /** Wallets that only work by handing off to their mobile app. */
  appOnly: WalletId[];
  /** Address the wallet is currently exposing (may exist without a session). */
  address: string | null;
  /** Set once a SIWS signature has been verified by the server. */
  session: WalletSession | null;
  connected: boolean;
  signingIn: boolean;
  balance: TokenBalance | null;
  balanceLoading: boolean;
  balanceError: string | null;
  error: string | null;
  walletName: string | null;

  connect(walletId?: WalletId): Promise<void>;
  disconnect(): Promise<void>;
  refreshBalance(mints: { mint: string | null; decimals: number }[]): Promise<void>;
  /** Sign the SIWS challenge and exchange it for a session. */
  signIn(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

export function WalletProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<WalletId[]>([]);
  const [appOnly, setAppOnly] = useState<WalletId[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);

  // Never store the provider object in state: it is not serialisable and some
  // wallets hand out a proxy that React would re-render around.
  const providerRef = useRef<SolanaProvider | null>(null);
  const lastAccountRef = useRef<string | null>(null);

  // ── Detect installed wallets ────────────────────────────────────────────
  // Probes every wallet in the catalogue, not a hardcoded trio, so adding a
  // wallet is a one-line change in wallets.tsx.
  useEffect(() => {
    const { connected, appOnly: apps } = detectWallets();
    setAvailable(connected.map((w) => w.id));
    setAppOnly(apps.map((w) => w.id));
  }, []);

  // ── Restore an existing server session on load ──────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json();
        if (alive && body?.data?.connected) {
          setSession({
            address: body.data.address,
            chain: body.data.chain,
            expiresAt: body.data.expiresAt,
          });
          setAddress(body.data.address);
        }
      } catch {
        /* not signed in — the button just shows "Connect" */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const clearSession = useCallback(async () => {
    setSession(null);
    setBalance(null);
    lastAccountRef.current = null;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* cookie may outlive the failure; harmless */
    }
  }, []);

  // ── Listen for account changes ──────────────────────────────────────────
  useEffect(() => {
    const p = providerRef.current;
    if (!p?.on) return;

    const onAccounts = (...args: unknown[]) => {
      const key = args[0] as { toString(): string } | null | undefined;
      const next = key ? key.toString() : null;
      if (next === lastAccountRef.current) return;
      // The user switched accounts in their wallet. The old signature no longer
      // describes the active address, so drop the session rather than showing
      // "connected" for the wrong wallet.
      lastAccountRef.current = next;
      setAddress(next);
      setBalance(null);
      void clearSession();
    };
    const onDisconnect = () => {
      lastAccountRef.current = null;
      setAddress(null);
      setBalance(null);
      void clearSession();
    };

    p.on('accountChanged', onAccounts);
    p.on('disconnect', onDisconnect);
    return () => {
      p.off?.('accountChanged', onAccounts);
      p.off?.('disconnect', onDisconnect);
    };
  }, [clearSession]);

  const connect = useCallback(async (walletId?: WalletId) => {
    setError(null);

    const id = walletId ?? available[0];

    /*
     * WalletConnect is a relay protocol, not an injected provider — there is no
     * global to call. It opens a QR / deep-link pairing flow instead, and the
     * real address arrives asynchronously via `subscribeAccount`. Returning early
     * here is deliberate: the "connected" state is driven by that callback, never
     * by an address we guessed before the user picked anything.
     */
    if (id === 'walletconnect') {
      const { openWalletConnect, walletConnectProvider } = await import('./walletconnect');
      providerRef.current = (await walletConnectProvider()) as SolanaProvider | null;
      setWalletName('WalletConnect');

      const opened = await openWalletConnect({
        onAccount: (address) => {
          if (!address) {
            // Disconnected in the wallet. Drop everything rather than leaving a
            // stale address on screen.
            setAddress(null);
            setSession(null);
            void clearSession();
            return;
          }
          lastAccountRef.current = address;
          setAddress(address);
          setSession((prev) => (prev && prev.address !== address ? null : prev));
        },
        onError: (m) => setError(m),
      });
      if (!opened) return;
      return;
    }

    if (!id) {
      setError('No Solana wallet detected. Install Phantom, Solflare or Backpack, or continue without connecting.');
      return;
    }
    const provider = findProvider(id);
    if (!provider) {
      setError(`${WALLETS.find((w) => w.id === id)?.label ?? 'That wallet'} is not available in this browser.`);
      return;
    }

    try {
      providerRef.current = provider;
      setWalletName(WALLETS.find((w) => w.id === id)?.label ?? id);

      // `onlyIfTrusted` suppresses the prompt when the wallet considers this
      // site untrusted, which avoids a scary dialog on page load.
      const res = await provider.connect({ onlyIfTrusted: true });
      const addr = res.publicKey.toString();
      lastAccountRef.current = addr;
      setAddress(addr);

      // If we already hold a session for a different address, discard it.
      setSession((prev) => (prev && prev.address !== addr ? null : prev));
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'Connection rejected';
      // 4001 = user rejected. That is not an error worth shouting about.
      if (!/reject/i.test(msg)) setError(msg);
      else setError(null);
    }
  }, [available]);

  /**
   * Full sign-in: request a nonce, sign the exact message we are given,
   * and exchange the signature for an httpOnly session cookie.
   *
   * Note the message is signed as *sent by our server* — we do not rebuild it
   * client-side, so what the user approves is byte-for-byte what gets verified.
   */
  const signIn = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || !address) return;

    setSigningIn(true);
    setError(null);
    try {
      const nonceRes = await fetch('/api/auth/nonce', { cache: 'no-store' });
      if (!nonceRes.ok) throw new Error('Could not start sign-in');
      const { data } = await nonceRes.json();

      // Sanity-check the challenge locally before asking the user to sign it, so
      // a compromised or misconfigured server cannot get the user to approve a
      // message for another site.
      const parsed = parseSignInMessage(data.message);
      if (!parsed || parsed.Chain !== data.chain || parsed.Nonce !== data.nonce) {
        throw new Error('Sign-in challenge did not come from this site.');
      }

      // Wallets sign raw bytes. `data.message` is the canonical string.
      const signature = await provider.signMessage(new TextEncoder().encode(data.message));
      const sigB58 = toBase58(normaliseSignature(signature));

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature: sigB58, nonce: data.nonce }),
      });
      const body = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(body?.error?.message ?? 'Signature was rejected');

      setSession({ address: body.data.address, chain: body.data.chain, expiresAt: body.data.expiresAt });
    } catch (e) {
      setError((e as Error).message);
      setSession(null);
    } finally {
      setSigningIn(false);
    }
  }, [address]);

  const disconnect = useCallback(async () => {
    try {
      await providerRef.current?.disconnect?.();
    } catch {
      /* ignore */
    }
    providerRef.current = null;
    lastAccountRef.current = null;
    setAddress(null);
    setWalletName(null);
    setBalance(null);
    await clearSession();
  }, [clearSession]);

  /**
   * Read-only balance lookup.
   *
   * Uses `getBalance` / `getTokenAccountsByOwner` — pure reads against a public
   * RPC. Nothing is signed and no private data leaves the browser.
   */
  const refreshBalance = useCallback(async (mints: { mint: string | null; decimals: number }[]) => {
    if (!address) {
      setBalance(null);
      return;
    }
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const rpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
        const res = await fetch(RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (!res.ok) throw new Error(`RPC ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error?.message ?? 'RPC error');
        return json.result as T;
      };

      const native = mints.find((m) => !m.mint);
      if (native) {
        const { value } = await rpc<{ value: number }>('getBalance', [address]);
        setBalance({ mint: '', amount: (value ?? 0) / 10 ** native.decimals, decimals: native.decimals });
      }

      // Sum every token account for the first SPL mint we are told about.
      const spl = mints.find((m) => m.mint);
      if (spl?.mint) {
        const res = await rpc<{ value: any[] }>('getTokenAccountsByOwner', [
          address,
          { mint: spl.mint },
          { encoding: 'jsonParsed' },
        ]);
        let sum = 0;
        for (const acc of res.value ?? []) {
          const amt = acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
          if (typeof amt === 'number') sum += amt;
        }
        setBalance((prev) => ({
          mint: spl.mint!,
          amount: sum,
          decimals: spl.decimals,
          ...(prev && !prev.mint && prev.amount > 0 ? { native: prev.amount } : {}),
        }) as TokenBalance);
      }
    } catch (e) {
      setBalanceError((e as Error).message);
      // Never let a balance read failure block checkout — it is advisory.
    } finally {
      setBalanceLoading(false);
    }
  }, [address]);

  // Expire the session client-side too, so the UI never shows a stale session.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      if (new Date(session.expiresAt).getTime() < Date.now()) {
        setSession(null);
        setAddress(null);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [session]);

  const value = useMemo<WalletContextValue>(
    () => ({
      available,
      appOnly,
      address,
      session,
      connected: Boolean(session),
      signingIn,
      balance,
      balanceLoading,
      balanceError,
      error,
      walletName,
      connect,
      disconnect,
      refreshBalance,
      signIn,
    }),
    [
      available,
      appOnly,
      address,
      session,
      signingIn,
      balance,
      balanceLoading,
      balanceError,
      error,
      walletName,
      connect,
      disconnect,
      refreshBalance,
      signIn,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}

export { shortAddress, SESSION_TTL_MS };

/** Phantom returns {signature}, others return raw bytes. */
function normaliseSignature(sig: unknown): Uint8Array {
  if (sig instanceof Uint8Array) return sig;
  const maybe = sig as { signature?: Uint8Array };
  if (maybe?.signature instanceof Uint8Array) return maybe.signature;
  throw new Error('Wallet returned an unexpected signature format');
}

/** Base58 without pulling a wallet library into the client bundle. */
function toBase58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const d of digits) out = ALPHABET[d];
  // Leading zero bytes map to '1's.
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out = `1${out}`;
  return out || '1';
}