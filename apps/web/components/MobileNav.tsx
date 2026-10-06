'use client';

/**
 * Mobile navigation drawer.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The desktop nav is `hidden lg:flex`, which meant below 1024px there was no
 * route to any category or to the FAQ from the header at all — only scrolling
 * the homepage. That is the majority of real visitors on a gift-card store, so
 * it is not a cosmetic gap.
 *
 * ── Behaviour details that matter on a phone ────────────────────────────────
 * - Opens and closes without layout shift: the header row keeps its height.
 * - `Escape` closes, and so does a click on the scrim.
 * - Scroll is locked while open, because a drawer that lets the page behind it
 *   scroll feels broken.
 * - Closes on route change, so tapping a category and pressing back does not
 *   leave the drawer covering the results.
 * - Focus moves into the panel on open and returns to the button on close.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ChevronRight } from 'lucide-react';

export interface MobileNavLink {
  href: string;
  label: string;
}

export default function MobileNav({
  links,
  faqHref,
}: {
  links: readonly MobileNavLink[];
  faqHref: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on navigation.
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Escape closes; scrim click closes; scroll behind the drawer is locked.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
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
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={close}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden animate-fade-in"
          />
          <div
            id="mobile-nav-panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-x-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-[var(--grid)] bg-[var(--bg)] lg:hidden animate-slide-up"
          >
            <nav className="px-4 py-3" aria-label="Mobile">
              {links.map((l) => (
                <DrawerLink key={l.href} href={l.href} onClick={close}>
                  {l.label}
                  <ChevronRight className="h-4 w-4 ml-auto text-[var(--muted)] shrink-0" />
                </DrawerLink>
              ))}
              <DrawerLink href={faqHref} onClick={close}>
                FAQ
                <ChevronRight className="h-4 w-4 ml-auto text-[var(--muted)] shrink-0" />
              </DrawerLink>
            </nav>
          </div>
        </>
      )}
    </>
  );
}

function DrawerLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="-mx-2 flex min-h-11 items-center border-b border-[var(--line)] px-2 text-[15px] text-[var(--text)] transition-colors last:border-b-0 hover:bg-[var(--elevated)]"
    >
      {children}
    </Link>
  );
}