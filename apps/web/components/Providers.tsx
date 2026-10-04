'use client';

import { CartProvider } from './CartProvider';
import { WalletProvider } from './WalletProvider';

/**
 * Client providers mounted once at the root.
 *
 * Both must wrap the entire tree: the cart badge and the connect-wallet button
 * both live in the header, outside the page content, so a provider scoped to a
 * single page would leave them permanently empty.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <CartProvider>{children}</CartProvider>
    </WalletProvider>
  );
}