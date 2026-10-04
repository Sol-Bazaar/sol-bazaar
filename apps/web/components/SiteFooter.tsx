import Link from 'next/link';
import { getTenant } from '@/lib/tenant';
import { brandOrDefaults } from '@solbazaar/tenant';
import { prisma } from '@solbazaar/db';

const RESOURCE_LINKS = [
  { href: '/products', label: 'All gift cards' },
  { href: '/products?sort=popular', label: 'Most popular' },
  { href: '/faq', label: 'How it works' },
  { href: '/faq#payments', label: 'Accepted crypto' },
];

const COMPANY_LINKS = [
  { href: '/terms', label: 'Terms of service' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/refunds', label: 'Refunds' },
  { href: '/contact', label: 'Contact support' },
];

export async function SiteFooter() {
  const tenant = await getTenant();
  const brand = brandOrDefaults(tenant);
  const supportEmail = brand.supportEmail || 'support@solbazaar.com';

  // Trust markers: only show what we can actually evidence.
  const stats = await prisma.order
    .aggregate({ _count: true, where: { status: 'COMPLETED' } })
    .then((r) => r._count)
    .catch(() => 0);

  return (
    <footer className="mt-24 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_45%,transparent)]">
      <div className="mx-auto max-w-[1600px] px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span
                className="grid h-8 w-8 place-items-center rounded-none text-[13px] font-medium text-white"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
                aria-hidden
              >
                {(brand.logoText || brand.name).slice(0, 1).toUpperCase()}
              </span>
              <span className="text-[17px] font-medium tracking-[-0.02em]">{brand.logoText || brand.name}</span>
            </div>
            <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-[var(--muted)]">{brand.tagline}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <TrustChip icon="bolt" label="Instant delivery" />
              <TrustChip icon="shield" label="Non-custodial" />
              <TrustChip icon="globe" label={`${stats > 0 ? `${stats.toLocaleString('en-US')}+ orders · ` : ''}190+ countries`} />
            </div>
          </div>

          <FooterCol title="Shop" links={RESOURCE_LINKS} />
          <FooterCol title="Legal" links={COMPANY_LINKS} />
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-[var(--line)] pt-6 text-[12.5px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {brand.legalName || brand.name}. All rights reserved.
          </p>
          {/*
            `flex-wrap` is load-bearing, not decoration. Three inline items plus
            two separators cannot fit a 320px viewport on one line, and a
            single-line flex row refuses to shrink below its content width — so
            this paragraph alone was pushing the whole document 21px wide
            horizontally at that size (5px at 360px). Confirmed by hiding
            subtrees one at a time until the overflow disappeared.
          */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden />
              Settled on Solana
            </span>
            <span aria-hidden>·</span>
            <a href="https://solscan.io" target="_blank" rel="noopener noreferrer nofollow" className="hover:text-[var(--text)]">
              View on Solscan
            </a>
            <span aria-hidden>·</span>
            <a href={`mailto:${supportEmail}`} className="hover:text-[var(--text)]">
              {supportEmail}
            </a>
          </p>
        </div>

        <p className="mt-5 text-[11.5px] leading-relaxed text-[color-mix(in_srgb,var(--muted)_78%,transparent)]">
          Gift card codes are issued by third-party brand partners. All brand names and logos are trademarks of their
          respective owners. {brand.name} is not affiliated with, endorsed by, or sponsored by any of the brands offered
          on this storefront. Cryptocurrency payments are irreversible; please double-check your payment before sending.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-bold uppercase tracking-wider text-[var(--muted)]">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            {/* `block py-1.5` lifts each link from an 18px line to a ~34px tap
                row. Footer links are a real navigation path on a phone, not
                fine print. */}
            <Link href={l.href} className="-mx-1 block px-1 py-1.5 text-[14px] text-[var(--muted)] transition-colors hover:text-[var(--text)]">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrustChip({ icon, label }: { icon: 'bolt' | 'shield' | 'globe'; label: string }) {
  const paths = {
    bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  };
  return (
    <span className="badge gap-1.5 py-1 text-[11.5px] font-semibold">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={paths[icon]} />
      </svg>
      {label}
    </span>
  );
}