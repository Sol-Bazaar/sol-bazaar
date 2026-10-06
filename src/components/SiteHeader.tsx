'use client';

import Link from 'next/link';
import { Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { CartButton } from './CartButton';
import { ConnectWallet } from './ConnectWallet';
import { HeroSearch } from './HeroSearch';
import { Search, Menu, X, ShoppingBag, Wallet, Globe, ChevronDown, ChevronRight } from 'lucide-react';

const MAIN_LINKS = [
  { href: '/products', label: 'All cards' },
  { href: '/products?category=gaming', label: 'Gaming' },
  { href: '/products?category=entertainment', label: 'Entertainment' },
  { href: '/products?category=store', label: 'Shopping' },
] as const;

export async function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--grid)] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 py-2" aria-label="GiftCard Store home">
          <span className="grid h-6 w-6 place-items-center border border-[var(--grid)] bg-[var(--surface)] text-[10px] font-medium" aria-hidden>
            G
          </span>
          <span className="text-[15px] font-medium tracking-[-0.03em] hidden sm:inline">GiftCard Store</span>
        </Link>

        <nav className="ml-5 hidden items-center gap-0.5 lg:flex" aria-label="Main navigation">
          {MAIN_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-none px-3 py-2 text-[13.5px] font-medium text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_70%,transparent)] hover:text-[var(--text)]">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <div className="hidden w-[240px] md:block xl:w-[300px]">
            <Suspense fallback={<div className="skeleton h-10 sm:h-9 rounded-none" />}>
              <HeroSearch placeholder="Search cards or brands…" />
            </Suspense>
          </div>

          <Link href="/products" className="btn btn-ghost h-10 sm:h-9 w-9 !px-0 md:hidden" aria-label="Search gift cards">
            <Search className="h-4 w-4" />
          </Link>

          <Suspense fallback={<div className="skeleton h-10 sm:h-9 w-9 rounded-none" />}>
            <ConnectWallet />
          </Suspense>

          <CartButton />
        </div>

        <MobileNav links={MAIN_LINKS} />
      </div>
    </header>
  );
}

function MobileNav({ links }: { links: readonly { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); buttonRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="btn btn-ghost h-10 w-10 !px-0 lg:hidden"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <>
          <button type="button" tabIndex={-1} aria-hidden onClick={close} className="fixed inset-0 z-40 bg-black/60 lg:hidden" />
          <div id="mobile-nav-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-x-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-[var(--grid)] bg-[var(--bg)] lg:hidden">
            <nav className="px-4 py-3" aria-label="Mobile">
              {links.map((l) => (
                <Link key={l.href} href={l.href} onClick={close} className="-mx-2 flex min-h-11 items-center border-b border-[var(--line)] px-2 text-[15px] text-[var(--text)] transition-colors last:border-b-0 hover:bg-[var(--elevated)]">
                  {l.label}
                  <ChevronRight className="h-4 w-4 ml-auto text-[var(--muted)] shrink-0" />
                </Link>
              ))}
            </nav>
          </div>
        </>
      )}
    </>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-none px-3 py-2 text-[13.5px] font-medium text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_70%,transparent)] hover:text-[var(--text)]">
      {children}
    </Link>
  );
}