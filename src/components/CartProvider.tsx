'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface CartLine {
  productId: string;
  productSlug: string;
  productName: string;
  faceValue: number;
  currency: string;
  unitPriceUsd: number;
  quantity: number;
  logoUrl?: string;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  subtotalUsd: number;
  hydrated: boolean;
  addLine: (line: Omit<CartLine, 'quantity'> & { quantity?: number }) => void;
  removeLine: (productId: string, faceValue: number) => void;
  updateQuantity: (productId: string, faceValue: number, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = 'gc_cart_v1';

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setLines(parsed);
      }
    } catch {
      // ignore
    } finally {
      setHydrated(true);
    }
  }, []);

  const persist = useCallback((next: CartLine[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const addLine = useCallback((line: Omit<CartLine, 'quantity'> & { quantity?: number }) => {
    setLines((prev) => {
      const existing = prev.findIndex(
        (l) => l.productId === line.productId && l.faceValue === line.faceValue
      );
      let next: CartLine[];
      if (existing >= 0) {
        next = prev.map((l, i) =>
          i === existing ? { ...l, quantity: l.quantity + (line.quantity ?? 1) } : l
        );
      } else {
        next = [...prev, { ...line, quantity: line.quantity ?? 1 }];
      }
      persist(next);
      return next;
    });
  }, [persist]);

  const removeLine = useCallback((productId: string, faceValue: number) => {
    setLines((prev) => {
      const next = prev.filter((l) => !(l.productId === productId && l.faceValue === faceValue));
      persist(next);
      return next;
    });
  }, [persist]);

  const updateQuantity = useCallback((productId: string, faceValue: number, quantity: number) => {
    if (quantity < 1) return;
    setLines((prev) => {
      const next = prev.map((l) =>
        l.productId === productId && l.faceValue === faceValue ? { ...l, quantity } : l
      );
      persist(next);
      return next;
    });
  }, [persist]);

  const clear = useCallback(() => {
    setLines([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const count = lines.reduce((a, l) => a + l.quantity, 0);
  const subtotalUsd = lines.reduce((a, l) => a + l.unitPriceUsd * l.quantity, 0);

  const value = { lines, count, subtotalUsd, hydrated, addLine, removeLine, updateQuantity, clear };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}