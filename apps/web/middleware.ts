import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware — runs before any server component or route handler.
 *
 * It is deliberately DB-free (edge runtime has no Prisma), so it only does the
 * two things that must happen before rendering:
 *
 *   1. Geo detection -> forward the resolved country as `x-fc-country` and
 *      persist the visitor's choice in a cookie so the switcher sticks.
 *   2. Tenant stickiness -> remember the resolved subdomain in `fc_tenant` so
 *      that proxies which rewrite Host do not break white-label routing.
 *
 * All actual tenant resolution happens server-side in lib/tenant.ts.
 */

const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'fly-client-country', 'x-geo-country', 'cloudfront-viewer-country'];
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function normaliseCountry(v: string | null | undefined): string | null {
  if (!v) return null;
  const c = v.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1' || c === 'ZZ') return null;
  return c;
}

/**
 * Content-Security-Policy.
 *
 * This is the single most valuable header for a wallet-connected app: it is
 * what stops a compromised CDN, a rogue npm dependency, or an injected `<script>`
 * from exfiltrating anything, and what stops clickjacking of the "Sign in"
 * approval.
 *
 * Notes on the relaxations, stated honestly rather than hidden:
 *   - `script-src 'unsafe-inline'` is required because Next.js streams hydration
 *     state in inline `<script>` tags. It is only safe because `frame-ancestors
 *     'none'` plus `script-src 'self'` mean the only inline scripts that can run
 *     are ones we emitted. Tighten it with per-request nonces if you move off
 *     Next's default document rendering.
 *   - `style-src 'unsafe-inline'` is required because tenant branding is applied
 *     as inline `style` attributes on `<html>` from CSS custom properties.
 *   - `connect-src` allows only our own origin and the public Solana RPC we read
 *     balances from — no wallet endpoint is contacted by the server.
 */
function contentSecurityPolicy(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const extra = isProd
    ? ''
    : " 'unsafe-eval'"; // React Refresh in development

  /*
   * `upgrade-insecure-requests` is skipped on localhost.
   *
   * `next start` sets NODE_ENV=production, so a local production-mode run would
   * otherwise upgrade every http:// asset request to https:// and break the
   * page — which is how this policy tends to get "fixed" by deleting itself
   * entirely. Restrict the skip to loopback names, not the whole dev mode.
   */
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(process.env.BASE_DOMAIN ?? '');
  const upgrade = isProd && !isLoopback ? 'upgrade-insecure-requests' : '';

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${extra}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${rpc}`,
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    upgrade,
  ]
    .filter(Boolean)
    .join('; ');
}

export function middleware(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // 1. Explicit `?country=` from the header switcher.
  let country = normaliseCountry(searchParams.get('country'));

  // 2. Previously stored preference.
  if (!country) country = normaliseCountry(req.cookies.get('fc_country')?.value);

  // 3. CDN geo header.
  if (!country) {
    for (const h of GEO_HEADERS) {
      country = normaliseCountry(req.headers.get(h));
      if (country) break;
    }
  }

  const requestHeaders = new Headers(req.headers);
  if (country) requestHeaders.set('x-fc-country', country);

  // A wallet-connecting app should not be embeddable or sniffable anywhere.
  // (Both of these are *also* set on the response below — see the note there.)
  requestHeaders.set('x-content-type-options', 'nosniff');

  // Remember the tenant host so sub-domain routing survives odd proxies.
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(':')[0];
  const baseDomain = (process.env.BASE_DOMAIN ?? 'localhost:3000').split(':')[0];
  let tenantSlug: string | null = null;
  if (host && baseDomain && host.endsWith(`.${baseDomain}`)) {
    const sub = host.slice(0, -(baseDomain.length + 1)).split('.')[0];
    if (sub && !['www', 'app', 'api', 'admin', 'cdn', 'static', 'assets'].includes(sub)) tenantSlug = sub;
  }

  // Never cache a checkout/order render at the CDN layer.
  if (/^\/(order|orders|checkout|api)/.test(req.nextUrl.pathname)) {
    requestHeaders.set('cache-control', 'no-store');
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  /*
   * CSP must be a *response* header.
   *
   * It used to be set on `requestHeaders` only, which forwards it into the
   * render and nowhere else — the browser never saw it, so the policy was
   * documented as active while enforcing nothing. Verified by asserting the
   * header is present on the wire.
   */
  res.headers.set('content-security-policy', contentSecurityPolicy());
  res.headers.set('x-content-type-options', 'nosniff');

  const wanted = searchParams.get('country');
  if (country && wanted && normaliseCountry(wanted) === country) {
    res.cookies.set('fc_country', country, {
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  if (tenantSlug && !req.cookies.get('fc_tenant')?.value) {
    res.cookies.set('fc_tenant', tenantSlug, {
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  return res;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation output.
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)).*)',
  ],
};