'use client';

import { CartProvider } from './CartProvider';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}