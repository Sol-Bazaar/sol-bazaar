/**
 * Wallet catalogue.
 *
 * ── Detection is honest, not optimistic ─────────────────────────────────────
 * A wallet is listed as *connectable* only when an injected provider we can
 * actually talk to is present. Wallet Standard (`navigator.wallets`) is checked
 * first because that is how modern extensions register, then each wallet's own
 * global as a fallback.
 *
 * Mobile apps (Glow, Trust, Exodus, and wallet2web features) cannot sign an
 * in-page message from an ordinary mobile browser. Rather than pretend, those
 * entries are `appOnly: true` and open the app via universal link / deep link.
 * The UI labels them "Open app" instead of "Connect", so nobody waits for a
 * dialog that will never appear.
 *
 * ── What is never requested ─────────────────────────────────────────────────
 * `connect()` (public address) and `signMessage()` (a free, human-readable
 * message). Never `signTransaction` outside the customer's own payment flow, and
 * never anything that touches a private key. There is no API here to import a
 * seed phrase, and adding one would be the single worst thing you could do to
 * this file.
 */

export interface WalletMeta {
  id: WalletId;
  label: string;
  /** One-line positioning, shown under the name. */
  blurb: string;
  /**
   * Injected provider globals to probe, in order. `window.ethereum` is included
   * for MetaMask, which now exposes Solana through its Multichain API / Solana
   * snap rather than a dedicated global.
   */
  globals: string[];
  /** Official page, used for "Get <wallet>". */
  site: string;
  /** Universal link / app scheme that opens the wallet app. */
  appLink?: string;
  /** True when the wallet can only be used by handing off to its mobile app. */
  appOnly?: boolean;
  accent: string;
  /** Rendered mark; bespoke so we never misappropriate a brand asset. */
  mark: React.ReactNode;
  note?: string;
}

export type WalletId =
  | 'phantom'
  | 'solflare'
  | 'backpack'
  | 'jupiter'
  | 'exodus'
  | 'glow'
  | 'trust'
  | 'metamask'
  | 'walletconnect';

const Mark = ({ children, accent }: { children: React.ReactNode; accent: string }) => (
  <span
    className="grid h-9 w-9 shrink-0 place-items-center rounded-none"
    style={{ background: `linear-gradient(140deg, ${accent}, color-mix(in srgb, ${accent} 55%, #05060a))` }}
    aria-hidden
  >
    {children}
  </span>
);

export const WALLETS: WalletMeta[] = [
  {
    id: 'phantom',
    label: 'Phantom',
    blurb: 'Multi-chain · NFTs · staking · social recovery',
    globals: ['phantom'],
    site: 'https://phantom.app/download',
    appLink: 'https://phantom.app/ul/browse/connect',
    accent: '#ab9ff2',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
        <path d="M12 2 4 12l3.4 1.1L12 7.6l4.6 5.5L20 12 12 2Zm0 20-8-10 3.4-1.1L12 16.4l4.6-5.5L20 12l-8 10Z" />
      </svg>
    ),
  },
  {
    id: 'solflare',
    label: 'Solflare',
    blurb: 'Native Solana · staking · validator picker',
    globals: ['solflare'],
    site: 'https://solflare.com/download',
    appLink: 'https://solflare.com/download',
    accent: '#fc7227',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
        <path d="M6 18.5 17 7.5h-5l4 4H6l3.5 3.5h7l1.5-1.5 4 4h-5l2 2h-5l-8-1Z" />
      </svg>
    ),
  },
  {
    id: 'backpack',
    label: 'Backpack',
    blurb: 'xNFTs · multisig · developer-friendly',
    globals: ['backpack'],
    site: 'https://backpack.exchange/download',
    appLink: 'https://backpack.exchange/download',
    accent: '#6b7cff',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
        <path d="M6 8a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Zm3 2.5h6V9H9v1.5Z" />
      </svg>
    ),
  },
  {
    id: 'jupiter',
    label: 'Jupiter',
    blurb: 'Best-in-class swaps · low fees · DeFi-native',
    globals: ['jupiter', 'jupitermx'],
    site: 'https://jup.ag/wallet',
    appLink: 'https://jup.ag/download',
    accent: '#c7f284',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#0b1410">
        <path d="M12 3 4 19h5l2.4-5.2L13.8 19H20L12 3Z" />
      </svg>
    ),
  },
  {
    id: 'exodus',
    label: 'Exodus',
    blurb: 'Multi-chain desktop & mobile · polished UI',
    globals: ['exodus'],
    site: 'https://www.exodus.com/download',
    appLink: 'exodus://',
    accent: '#1b66f1',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
        <path d="M13.5 2 4 13h6l-1.5 9L19 10h-6l.5-8Z" />
      </svg>
    ),
  },
  {
    id: 'glow',
    label: 'Glow',
    blurb: 'Mobile-first · zero-fee swaps',
    globals: [],
    site: 'https://glow.app',
    appLink: 'https://glow.app/download',
    appOnly: true,
    accent: '#8a5cf6',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'trust',
    label: 'Trust Wallet',
    blurb: '100+ blockchains · iOS & Android',
    globals: [],
    site: 'https://trustwallet.com/download',
    appLink: 'https://trustwallet.com/download',
    appOnly: true,
    accent: '#3375bb',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
        <path d="M12 2 4 5.5v6c0 5 3.4 9.4 8 10.5 4.6-1.1 8-5.5 8-10.5v-6L12 2Zm0 5.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z" />
      </svg>
    ),
  },
  {
    id: 'metamask',
    label: 'MetaMask',
    blurb: 'Solana via Multichain / snap · Ethereum users',
    // MetaMask no longer sets `window.metamask`; it sets `window.ethereum`, and
    // exposes Solana there once the Multichain API or Solana snap is enabled.
    globals: ['ethereum'],
    site: 'https://metamask.io/download/',
    accent: '#f6851b',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
        <path d="M12 2 4 5.5 12 9l8-3.5L12 2Zm0 20 8-3.5L12 22l-8-3.5L12 22ZM4 8l8 4 8-4M4 12.5 12 16l8-3.5" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      </svg>
    ),
    note: 'Needs the Solana snap or Multichain API enabled in MetaMask.',
  },
  {
    id: 'walletconnect',
    label: 'WalletConnect',
    blurb: '300+ wallets · mobile · desktop · any Solana wallet',
    // No injected global — WalletConnect is a relay protocol reached over QR or
    // a deep link, so `findProvider` can never resolve it. It is opened through
    // `components/walletconnect.ts` instead, which is why it is excluded from
    // the detection sweep below.
    globals: [],
    site: 'https://walletconnect.com/explorer',
    accent: '#3B99FC',
    mark: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2" aria-hidden>
        <path d="M7 8.5h10l-3.2 3.2a4.2 4.2 0 0 0 0 5.9" strokeLinecap="round" />
        <path d="M4.6 6h10.8a7 7 0 0 1 0 12H11" strokeLinecap="round" opacity=".55" />
      </svg>
    ),
    note: 'Works with mobile wallets that cannot sign in a desktop browser tab.',
  },
];

// ── Provider access ─────────────────────────────────────────────────────────

export interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  signMessage(message: Uint8Array | string): Promise<{ signature: Uint8Array } | Uint8Array>;
  on?(event: string, handler: (...a: unknown[]) => void): void;
  off?(event: string, handler: (...a: unknown[]) => void): void;
}

/** Wallet Standard entries Phantom/Backpack/Solflare register into. */
interface StandardWallet {
  name?: string;
  icon?: string;
  features?: Record<string, unknown>;
  accounts?: { address: string; chains: string[] }[];
}

declare global {
  interface Window {
    phantom?: SolanaProvider;
    solflare?: SolanaProvider;
    backpack?: SolanaProvider;
    jupiter?: SolanaProvider;
    jupitermx?: SolanaProvider;
    exodus?: SolanaProvider;
    /** Legacy alias several Solana extensions still set. */
    solana?: SolanaProvider;
  }
  /**
   * `window.ethereum` is deliberately NOT declared here.
   *
   * `@reown/appkit` already augments it as `Record<string, unknown>`, and a
   * second declaration with a different type is a TS2717 conflict across the
   * whole project. `findProvider` casts at the single point of use instead —
   * MetaMask's Solana surface is reached through its Multichain API or Solana
   * snap, neither of which types as a Solana provider anyway.
   */
  interface Navigator {
    wallets?: StandardWallet[];
  }
}

/**
 * Resolve an injected provider for a wallet.
 *
 * Order matters: a wallet's own global is more specific than `window.ethereum`,
 * and `window.ethereum` is shared by every EVM wallet, so it is checked last.
 */
export function findProvider(id: WalletId): SolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const meta = WALLETS.find((w) => w.id === id);
  if (!meta || meta.globals.length === 0) return null;

  const w = window as unknown as Record<string, unknown>;
  for (const g of meta.globals) {
    // `ethereum` is untyped by design — see the note in the global declaration.
    const p = w[g] as SolanaProvider | undefined;
    if (p && typeof p.connect === 'function' && typeof p.signMessage === 'function') return p;
  }

  // Wallet Standard fallback: some builds only register here.
  const standard = typeof navigator !== 'undefined' ? navigator.wallets ?? [] : [];
  const match = standard.find((w2) =>
    (w2.name ?? '').toLowerCase().includes(id === 'metamask' ? 'meta' : id),
  );
  if (match) return standardToProvider(match);

  // `window.solana` is a legacy alias several extensions still set.
  if (id !== 'metamask' && window.solana) {
    const p = window.solana;
    if (typeof p.connect === 'function' && typeof p.signMessage === 'function') return p;
  }
  return null;
}

function standardToProvider(w: StandardWallet): SolanaProvider {
  return {
    async connect() {
      // Wallet Standard connect returns { accounts, disconnect }.
      const anyW = w as unknown as {
        connect?(o?: { chain?: string }): Promise<{ accounts: { address: string }[] }>;
        disconnect?(): Promise<void>;
      };
      const res = await anyW.connect?.({ chain: 'solana:mainnet' });
      const addr = res?.accounts?.[0]?.address ?? w.accounts?.[0]?.address ?? '';
      if (!addr) throw new Error('Wallet returned no account');
      return { publicKey: { toString: () => addr } };
    },
    async disconnect() {
      const anyW = w as unknown as { disconnect?(): Promise<void> };
      await anyW.disconnect?.();
    },
    // Wallet Standard messages are transported as UTF-8 bytes by convention.
    async signMessage(msg) {
      const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : msg;
      const res = await (w.features as unknown as {
        'standard:signMessage'?: (d: { message: Uint8Array }) => Promise<{ signature: Uint8Array[] }>;
      })['standard:signMessage']?.({ message: bytes });
      const sig = res?.signature?.[0];
      if (!sig) throw new Error('Wallet did not return a signature');
      return sig;
    },
  };
}

/** Which wallets can actually sign in this browser, in catalogue order. */
export function detectWallets(): { connected: WalletMeta[]; appOnly: WalletMeta[] } {
  const connected: WalletMeta[] = [];
  const appOnly: WalletMeta[] = [];
  for (const w of WALLETS) {
    // WalletConnect is not detectable by probing globals — it is a relay, opened
    // on demand. `globals: []` already excludes it from `findProvider`, so this
    // branch just makes the intent explicit rather than relying on that.
    if (w.id === 'walletconnect') continue;
    if (w.appOnly && !findProvider(w.id)) appOnly.push(w);
    else if (findProvider(w.id)) connected.push(w);
  }
  return { connected, appOnly };
}

/** Mobile app store links, so "Get" lands on the right platform. */
export function installLinks(site: string): { ios?: string; android?: string; web: string } {
  return { web: site };
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}