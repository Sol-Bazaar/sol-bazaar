'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';

export interface CartLine {
  productSlug: string;
  productName: string;
  logoUrl: string | null;
  /** Denomination face value, e.g. "50.00" */
  faceValue: string;
  currency: string;
  /** Per-unit price in USD including tenant markup. */
  unitPriceUsd: string;
  quantity: number;
  accent: string | null;
}

interface CartState {
  lines: CartLine[];
  add: (line: Omit<CartLine, 'quantity'>, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** True until the persisted cart has been read (prevents a hydration flash). */
  hydrated: boolean;
  count: number;
  subtotalUsd: number;
  savingsUsd: number;
}

const CartContext = createContext<CartState | null>(null);
const STORAGE_KEY = 'fc.cart.v1';

export const lineKey = (l: Pick<CartLine, 'productSlug' | 'faceValue'>) => `${l.productSlug}::${l.faceValue}`;

/**
 * Client-side cart persisted to localStorage.
 *
 * Prices live in the cart purely for display; the server re-prices every line
 * from the database inside the order transaction, so a tampered localStorage can
 * never change what a customer is charged.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setLines(parsed.filter(isValidLine));
      }
    } catch {
      /* corrupt cart -> start empty */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* private mode / quota — the cart still works for this session */
    }
  }, [lines, hydrated]);

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      try {
        setLines(e.newValue ? JSON.parse(e.newValue).filter(isValidLine) : []);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((line: Omit<CartLine, 'quantity'>, qty = 1) => {
    const key = lineKey(line);
    setLines((prev) => {
      const i = prev.findIndex((l) => lineKey(l) === key);
      if (i === -1) return [...prev, { ...line, quantity: Math.min(50, qty) }];
      const next = [...prev];
      next[i] = { ...next[i], quantity: Math.min(50, next[i].quantity + qty) };
      return next;
    });
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setLines((prev) =>
      qty <= 0 ? prev.filter((l) => lineKey(l) !== key) : prev.map((l) => (lineKey(l) === key ? { ...l, quantity: Math.min(50, qty) } : l)),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => lineKey(l) !== key));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<CartState>(() => {
    const count = lines.reduce((a, l) => a + l.quantity, 0);
    const subtotalUsd = lines.reduce((a, l) => a + Number(l.unitPriceUsd) * l.quantity, 0);
    const faceTotal = lines.reduce((a, l) => a + Number(l.faceValue) * l.quantity, 0);
    return {
      lines,
      add,
      setQty,
      remove,
      clear,
      hydrated,
      count,
      subtotalUsd,
      savingsUsd: Math.max(0, subtotalUsd - faceTotal),
    };
  }, [lines, add, setQty, remove, clear, hydrated]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}

function isValidLine(l: unknown): l is CartLine {
  if (!l || typeof l !== 'object') return false;
  const x = l as Record<string, unknown>;
  return (
    typeof x.productSlug === 'string' &&
    typeof x.faceValue === 'string' &&
    typeof x.quantity === 'number' &&
    x.quantity > 0 &&
    Number.isFinite(x.quantity)
  );
}