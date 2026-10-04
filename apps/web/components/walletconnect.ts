'use client';

/**
 * WalletConnect (via Reown AppKit) for Solana.
 *
 * ── Why this is lazy ────────────────────────────────────────────────────────
 * AppKit pulls in ~340 packages. Loading it on every page would hand every
 * visitor a large dependency they may never use, so it is `import()`ed only when
 * someone actually reaches for it. The catalogue still renders instantly.
 *
 * ── Why it is gated on an env var ───────────────────────────────────────────
 * WalletConnect requires a free projectId from cloud.reown.com. Without one the
 * modal cannot initialise, so rather than render a button that opens an error we
 * hide the option entirely and the rest of the wallet list works unchanged.
 *
 * ── Why Solana-specific ─────────────────────────────────────────────────────
 * We deliberately support one chain. AppKit's Solana adapter is configured
 * against a single CAIP network id, and pinning it means a customer cannot
 * connect a wallet sitting on the wrong chain and be silently quoted for a
 * deposit that will never arrive.
 *
 * ── What it is NOT used for ─────────────────────────────────────────────────
 * Only `connect()` and `signMessage()`. AppKit exposes far more, but a payment
 * page that can request a transaction signature is a drainer waiting to happen.
 * Customers approve their own payment in their own wallet, with the amount on
 * screen. There is no code path from this module to `signTransaction`.
 */

/** CAIP-2 network ids. Pinned so a wrong-chain wallet fails loudly. */
const CAIP = {
  'mainnet-beta': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  testnet: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
} as const;

export function projectId(): string | null {
  const v = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  return v && v.length > 10 ? v : null;
}

/** False when no projectId is configured — callers should hide the option. */
export function walletConnectAvailable(): boolean {
  return projectId() !== null;
}

/** The network AppKit will be pinned to. */
function targetCaip(): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet';
  return CAIP[cluster as keyof typeof CAIP] ?? CAIP.devnet;
}

interface Modal {
  open(opts?: { view?: string }): void;
  close(): void;
  subscribeAccount(cb: (account: { address?: string; isConnected: boolean } | null) => void): () => void;
  getAddress?(): string | undefined;
  disconnect?(): Promise<void>;
}

let modalPromise: Promise<Modal | null> | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Create (once) and return the AppKit modal.
 *
 * Memoised as a promise, not just a value: two components can reach for this in
 * the same tick and must not end up with two modals fighting over focus.
 */
async function getModal(): Promise<Modal | null> {
  if (modalPromise) return modalPromise;

  modalPromise = (async () => {
    const pid = projectId();
    if (!pid) return null;
    try {
      const [{ createAppKit }, { SolanaAdapter }] = await Promise.all([
        import('@reown/appkit'),
        import('@reown/appkit-adapter-solana'),
      ]);
      const { solana, solanaDevnet } = await import('@reown/appkit/networks');

      const caip = targetCaip();
      const network = caip === CAIP['mainnet-beta'] ? solana : solanaDevnet;

      return createAppKit({
        adapters: [
          new SolanaAdapter({
            connectionSettings: 'confirmed',
            // Register Wallet Standard wallets too. Phantom, Solflare and
            // Backpack all implement it, and leaving it off would mean a
            // WalletConnect user has to rediscover their own wallet in a list
            // that already contains it.
            registerWalletStandard: true,
          }),
        ],
        networks: [network],
        projectId: pid,
        metadata: {
          name: 'Sol Bazaar',
          description: 'Gift cards, paid with crypto.',
          // Must match APP_URL or the WalletConnect pairing is rejected.
          url: typeof window !== 'undefined' ? window.location.origin : 'https://solbazaar.com',
          icons: [`${typeof window !== 'undefined' ? window.location.origin : ''}/icon.png`],
        },
        // WalletConnect is a third party in the connection path, so analytics is
        // off: connection metadata never leaves the customer's device unasked.
        features: { analytics: false },
      }) as unknown as Modal;
    } catch (e) {
      console.error('[walletconnect] init failed', e);
      return null;
    }
  })();

  return modalPromise;
}

/**
 * Open the picker.
 *
 * `onAccount` fires whenever the connected account changes, including on
 * disconnect — the caller is responsible for clearing its state, because a
 * silent "still thinks you're connected" is the worst failure mode here.
 */
export async function openWalletConnect(opts: {
  onAccount: (address: string | null) => void;
  onError?: (message: string) => void;
}): Promise<boolean> {
  const modal = await getModal();
  if (!modal) {
    opts.onError?.('WalletConnect is not configured. Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable it.');
    return false;
  }

  unsubscribe?.();
  unsubscribe = modal.subscribeAccount((account) => {
    opts.onAccount(account?.isConnected ? (account.address ?? null) : null);
  });

  modal.open();
  return true;
}

export async function closeWalletConnect(): Promise<void> {
  unsubscribe?.();
  unsubscribe = null;
  const modal = await modalPromise;
  modal?.close();
}

/**
 * Adapt AppKit into the `SolanaProvider` shape the rest of the app speaks.
 *
 * This is what lets a WalletConnect wallet go through the *same* Sign-In With
 * Solana path as an injected Phantom: identical challenge, identical signature
 * verification, one code path to audit.
 */
export async function walletConnectProvider(): Promise<{
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signMessage: (message: Uint8Array | string) => Promise<{ signature: Uint8Array }>;
  disconnect: () => Promise<void>;
} | null> {
  const modal = await getModal();
  if (!modal) return null;

  return {
    async connect() {
      modal.open();
      /*
       * We deliberately do not resolve with a guessed address. The caller gets
       * the real address through `subscribeAccount`, which fires when the user
       * actually picks an account. Returning early here would let the UI show a
       * connected state for an address we never verified.
       */
      return new Promise(() => {});
    },
    async signMessage(message) {
      /*
       * Signing goes through whichever provider AppKit resolved for the active
       * connection. Reached only after a real connection, so it is present.
       *
       * Typed loosely on purpose: AppKit does not export its provider type, and
       * the guard below is what actually protects us — an unexpected shape throws
       * instead of signing something we did not intend.
       */
      const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
      const provider = (modal as any).provider;
      if (!provider?.signMessage) throw new Error('WalletConnect provider is not ready yet');

      const res = await provider.signMessage(bytes, 'utf8');
      const sig = res?.signature?.[0] ?? res?.signature;
      if (!sig || typeof sig !== 'object') throw new Error('Wallet returned no signature');
      return { signature: sig as Uint8Array };
    },
    async disconnect() {
      await modal.disconnect?.();
    },
  };
}