import Link from 'next/link';
import { Suspense } from 'react';
import { getTenant } from '@/lib/tenant';
import { brandOrDefaults } from '@solbazaar/tenant';
import { CountrySwitcher } from './CountrySwitcher';
import { CartButton } from './CartButton';
import { TokenTicker } from './TokenTicker';
import { ConnectWallet } from './ConnectWallet';
import { SearchBar } from './SearchBar';
import MobileNav from './MobileNav';

/**
 * Single source of truth for both navigations.
 *
 * The desktop nav and the mobile drawer render from this same list, so they
 * cannot drift apart. Deliberately not read from the database: `listCategories`
 * runs several queries and the header renders on every page, and the desktop nav
 * has always been static. If categories ever need to be tenant-configurable,
 * change this to a cached lookup — do not let the two navs diverge first.
 */
const MAIN_LINKS = [
  { href: '/products', label: 'All cards' },
  { href: '/products?category=store', label: 'Store' },
  { href: '/products?category=gaming', label: 'Gaming' },
  { href: '/products?category=entertainment', label: 'Entertainment' },
  { href: '/products?category=payment-cards', label: 'Payment cards' },
] as const;

export async function SiteHeader() {
  const tenant = await getTenant();
  const brand = brandOrDefaults(tenant);
  const logoText = brand.logoText || brand.name;

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--grid)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 py-2" aria-label={`${brand.name} home`}>
          {brand.logoUrl ? (
            /*
             * `h-6 w-auto` because the mark is portrait — a fixed square would
             * letterbox it to about half the intended size. `fetchPriority=high`
             * because the logo is the LCP element on most pages.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt=""
              width={112}
              height={171}
              fetchPriority="high"
              decoding="async"
              className="h-6 w-auto shrink-0 object-contain"
            />
          ) : (
            // Monogram fallback. Solid rather than a gradient: the chrome is
            // deliberately colourless, and a gradient chip is the one element
            // that would fight the brand logos in the grid below it.
            <span
              className="grid h-6 w-6 place-items-center border border-[var(--grid)] bg-[var(--surface)] text-[10px] font-medium"
              aria-hidden
            >
              {logoText.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="text-[15px] font-medium tracking-[-0.03em]">{logoText}</span>
        </Link>

        {/*
          Mobile navigation.

          The desktop nav is `hidden lg:flex`, so below 1024px there was no route
          to any category or the FAQ at all — the only way in was scrolling the
          homepage. This is a client component because it needs open/close state;
          everything else in this header stays server-rendered.
        */}
        <MobileNav links={MAIN_LINKS} faqHref="/faq" />

        <nav className="ml-5 hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {MAIN_LINKS.map((l) => (
            <HeaderLink key={l.href} href={l.href}>
              {l.label}
            </HeaderLink>
          ))}
          <HeaderLink href="/faq">FAQ</HeaderLink>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {/* Search: always reachable, but collapses to an icon on small screens. */}
          <div className="hidden w-[240px] md:block xl:w-[300px]">
            <Suspense fallback={<div className="skeleton h-10 sm:h-9 rounded-none" />}>
              <SearchBar placeholder="Search cards or brands…" />
            </Suspense>
          </div>

          <Link
            href="/products"
            className="btn btn-ghost h-10 sm:h-9 w-9 !px-0 md:hidden"
            aria-label="Search gift cards"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </Link>

          <Suspense fallback={<div className="skeleton h-10 sm:h-9 w-24 rounded-none" />}>
            <TokenTicker />
          </Suspense>
          <Suspense fallback={<div className="skeleton h-10 sm:h-9 w-9 rounded-none" />}>
            <CountrySwitcher />
          </Suspense>
          <div id="connect-wallet">
            <ConnectWallet />
          </div>
          <CartButton />
        </div>
      </div>
    </header>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-none px-3 py-2 text-[13.5px] font-medium text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--elevated)_70%,transparent)] hover:text-[var(--text)]"
    >
      {children}
    </Link>
  );
}