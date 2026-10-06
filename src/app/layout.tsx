import type { Metadata, Viewport } from 'next';
import { Outfit, Roboto_Mono } from 'next/font/google';
import './globals.css';

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

export const metadata: Metadata = {
  title: {
    default: 'Sol Bazaar — Buy Gift Cards with Crypto',
    template: '%s · Sol Bazaar',
  },
  description: 'Buy gift cards instantly with USDC on Solana. 6,600+ brands, 180+ countries, instant delivery.',
  applicationName: 'Sol Bazaar',
  openGraph: {
    title: 'Sol Bazaar — Buy Gift Cards with Crypto',
    description: 'Instant digital delivery. Pay with USDC on Solana — settled on-chain in seconds.',
    type: 'website',
    siteName: 'Sol Bazaar',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0A090F' },
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${robotoMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}