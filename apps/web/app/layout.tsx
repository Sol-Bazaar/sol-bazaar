import type { Metadata, Viewport } from 'next';
import { Outfit, Roboto_Mono } from 'next/font/google';
import { getTenant, getGeo } from '@/lib/tenant';
import { resolveTheme, themeStyle, brandOrDefaults } from '@solbazaar/tenant';
import { countryLabel } from '@solbazaar/core';
import { Providers } from '@/components/Providers';
import './globals.css';

/*
 * Outfit for display, Roboto Mono for everything utilitarian (labels, prices,
 * addresses, amounts).
 *
 * The mono is not decoration: half the interface is figures and identifiers —
 * order numbers, lamport amounts, deposit addresses, FX rates. A proportional
 * face makes columns of numbers ragged and long hashes harder to compare, so the
 * mono carries every number on the site.
 *
 * Self-hosted by `next/font`, so there is no third-party request at runtime and
 * no layout shift.
 */
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
  weight: ['400', '500', '600'],
});

const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto-mono',
  weight: ['400', '500'],
});

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const brand = brandOrDefaults(tenant);
  const geo = await getGeo().catch(() => ({ country: 'US' }) as any);

  return {
    title: {
      default: `${brand.name} — ${brand.tagline}`,
      template: `%s · ${brand.name}`,
    },
    description: `${brand.heroSubhead} Available in ${countryLabel(geo.country)}.`,
    applicationName: brand.name,
    openGraph: {
      title: `${brand.name} — ${brand.tagline}`,
      description: brand.heroSubhead,
      type: 'website',
      siteName: brand.name,
    },
    twitter: { card: 'summary_large_image' },
    robots: { index: true, follow: true },
    alternates: { canonical: '/' },
  };
}

export const viewport: Viewport = {
  // Must track the tenant palette, or the mobile browser chrome (address bar,
  // pull-to-refresh overscroll) renders a different colour from the page and the
  // seam is visible on every scroll. It was hardcoded to the pre-redesign
  // near-black and went stale; keep it in sync with DARK.background in
  // packages/tenant/src/theme.ts.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0A090F' },
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
  ],
  width: 'device-width',
  initialScale: 1,
  // The theme clamps `maximumScale` deliberately: pinch-zoom is an accessibility
  // feature and disabling it fails WCAG 1.4.4.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  const geo = await getGeo().catch(() => ({ country: 'US' }) as any);
  const theme = resolveTheme(tenant);
  const brand = brandOrDefaults(tenant);

  /*
   * The single source of truth for the palette. Previously this also hardcoded
   * `--elevated` and `--line` here, which silently overrode whatever
   * `themeStyle()` resolved — a light-mode tenant still got the dark chrome's
   * borders. Every token now comes from one place.
   */
  const style = themeStyle(theme) as React.CSSProperties;

  return (
    <html lang="en" style={style} className={`${outfit.variable} ${robotoMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {brand.announcement ? (
          <div className="relative z-50 bg-[linear-gradient(90deg,var(--accent),var(--accent-2))] px-4 py-2 text-center text-[13px] font-semibold text-white">
            {brand.announcement}
          </div>
        ) : null}
        <Providers>{children}</Providers>
        {/* Server-rendered geo hint: lets client components personalise copy
            without a second round-trip, and documents the resolved market. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__FC__={country:${JSON.stringify(geo.country)},tenant:${JSON.stringify(tenant.slug)},source:${JSON.stringify(geo.source)}}`,
          }}
        />
      </body>
    </html>
  );
}