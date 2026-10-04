import type { NextConfig } from 'next';
import { config as loadEnvFile } from 'dotenv';
import path from 'node:path';

/*
 * Load the repo-root `.env` into `process.env` before Next reads anything.
 *
 * Next only auto-loads `.env*` from its own working directory, which for this
 * workspace is `apps/web`. Our env file lives at the repo root because the
 * worker, Prisma and the scripts all share it — so without this line Next sees
 * *none* of it.
 *
 * The failure mode is quiet and nasty: every Next-side lookup silently falls back
 * to its hardcoded default, and the defaults happen to match development values.
 * So `SOLANA_CLUSTER`, `BASE_DOMAIN` and all `NEXT_PUBLIC_*` looked correct while
 * actually being ignored — and `NEXT_PUBLIC_*` were never inlined into the client
 * bundle at all, because Next inlines them at build time from its own env.
 *
 * `dotenv` does not overwrite variables that are already set, so a real
 * deployment that supplies its own environment (or an `apps/web/.env.local`)
 * still wins. This only fills in what is missing.
 */
loadEnvFile({ path: path.resolve(process.cwd(), '../../.env') });
loadEnvFile({ path: path.resolve(process.cwd(), '.env.local') });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Workspace packages ship raw TS; Next compiles them via transpilePackages.
  // (path aliases alone are not enough — the resolver still needs to treat the
  // symlinked package as source, not as a published build.)
  transpilePackages: [
    '@solbazaar/core',
    '@solbazaar/db',
    '@solbazaar/crypto',
    '@solbazaar/tenant',
    '@solbazaar/provider',
    '@solbazaar/jobs',
    '@solbazaar/fulfillment',
  ],

  // `@solbazaar/core/client` is the browser-safe entry. Without this alias the
  // `exports` map in core's package.json is not honoured by Next's resolver.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@solbazaar/core/client': new URL('../../packages/core/src/client.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    };
    return config;
  },

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  experimental: {
    // Server Actions carry the checkout mutations (fewer round trips, and the
    // cart survives a JS-less failure more gracefully than a bare fetch).
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
        ],
      },
      {
        // Checkout/order pages must never be cached by a CDN or a shared proxy.
        source: '/(checkout|order|orders|cart|api)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;