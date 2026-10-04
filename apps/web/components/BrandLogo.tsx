'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Brand logo with a guaranteed-intentional fallback.
 *
 * Two problems this solves:
 *
 *  1. **Never a broken image.** If the logo CDN is blocked, rate-limited, or the
 *    brand has no mark available, `onError` swaps in a monogram. A gift-card grid
 *     full of broken-image icons looks broken; a grid of clean monogram tiles
 *     looks designed.
 *
 *  2. **Deterministic colours.** The fallback derives its gradient from the
 *    product slug (or a brand colour when we know one), so the same card always
 *     looks the same across renders and machines — important because a random hue
 *     per render would cause hydration mismatches.
 *
 * `<img>` rather than `next/image` on purpose: the source is a third-party CDN
 * with dynamic paths, and these are 48px tiles where the optimiser buys nothing.
 */

/** Known brand colours, used for the monogram fallback and the tile wash. */
const BRAND_COLORS: Record<string, { from: string; to: string }> = {
  netflix: { from: '#E50914', to: '#B20710' },
  spotify: { from: '#1DB954', to: '#12833C' },
  disney: { from: '#113CCF', to: '#0B2A94' },
  hulu: { from: '#1CE783', to: '#0FA85F' },
  amazon: { from: '#FF9900', to: '#D97706' },
  walmart: { from: '#0071DC', to: '#00509B' },
  target: { from: '#E31837', to: '#B3122B' },
  ebay: { from: '#E53238', to: '#B62327' },
  steam: { from: '#1B2838', to: '#0E1A26' },
  xbox: { from: '#107C10', to: '#0A5C0A' },
  playstation: { from: '#006FCD', to: '#004A87' },
  nintendo: { from: '#E60012', to: '#B2000E' },
  roblox: { from: '#E2231A', to: '#A81A14' },
  discord: { from: '#5865F2', to: '#3A45C9' },
  epicgames: { from: '#313131', to: '#1C1C1C' },
  riotgames: { from: '#D83B01', to: '#9A2A01' },
  ubisoft: { from: '#E1000F', to: '#A8000C' },
  blizzard: { from: '#2481E5', to: '#1757A0' },
  airbnb: { from: '#FF5A5F', to: '#D0363A' },
  booking: { from: '#003B95', to: '#00256A' },
  expedia: { from: '#FFC72C', to: '#D6A218' },
  delta: { from: '#C8102E', to: '#9A0C24' },
  uber: { from: '#000000', to: '#222222' },
  lyft: { from: '#FF00BF', to: '#CC0099' },
  starbucks: { from: '#00754A', to: '#005238' },
  doordash: { from: '#FF3008', to: '#CC2606' },
  deliveroo: { from: '#00CCBC', to: '#009E92' },
  nike: { from: '#111111', to: '#3D3D3D' },
  adidas: { from: '#000000', to: '#333333' },
  zara: { from: '#000000', to: '#3A3A3A' },
  apple: { from: '#555555', to: '#1D1D1F' },
  samsung: { from: '#1428A0', to: '#0C1B6E' },
  google: { from: '#4285F4', to: '#2A5FB0' },
  bestbuy: { from: '#0046BE', to: '#00328A' },
  ikea: { from: '#0058A3', to: '#003D72' },
  wayfair: { from: '#7F187F', to: '#5A115A' },
  shell: { from: '#FFD100', to: '#D9AC00' },
  tesla: { from: '#CC0000', to: '#8F0000' },
  adobe: { from: '#FF0000', to: '#C00000' },
  microsoft: { from: '#F25022', to: '#00A4EF' },
  nordvpn: { from: '#2F6BFF', to: '#1B49C4' },
  surfshark: { from: '#00A1C1', to: '#00788C' },
  internxt: { from: '#1E6EFF', to: '#0B47C4' },
  rewarble: { from: '#F7931A', to: '#C46F10' },
  paysafecard: { from: '#E4002B', to: '#B00021' },
  coingate: { from: '#00C2A8', to: '#00927F' },
  ticketmaster: { from: '#0264D0', to: '#014894' },
  jetbrains: { from: '#FE2853', to: '#C81D3C' },
  notion: { from: '#111111', to: '#444444' },
  decathlon: { from: '#0A2D69', to: '#061B45' },
  eventbrite: { from: '#F05537', to: '#B83C27' },
  viator: { from: '#00A88F', to: '#007A68' },
  thomann: { from: '#E30613', to: '#A3040D' },
};

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function BrandLogo({
  slug,
  name,
  src,
  size = 'md',
  className = '',
}: {
  slug: string;
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // A new src deserves a fresh attempt at the real logo.
  useEffect(() => setFailed(false), [src]);

  const colors = useMemo(() => {
    const key = Object.keys(BRAND_COLORS).find((k) => slug.includes(k));
    if (key) return BRAND_COLORS[key];
    const hue = hashHue(slug);
    return { from: `hsl(${hue} 62% 46%)`, to: `hsl(${(hue + 38) % 360} 58% 30%)` };
  }, [slug]);

  /*
 * Square, no radius — the mark sits inside a grid cell, and a rounded tile in a
 * square cell reads as a mistake rather than a choice.
 */
const box =
    size === 'sm'
      ? 'h-9 w-9 text-[10.5px]'
      : size === 'lg'
        ? 'h-16 w-16 text-[22px]'
        : 'h-11 w-11 text-[13px]';

  if (src && !failed) {
    return (
      <span className={`relative grid shrink-0 place-items-center overflow-hidden border border-white/10 ${box} ${className}`} style={{ background: `linear-gradient(140deg, ${colors.from}, ${colors.to})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-[18%]"
        />
      </span>
    );
  }

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-white/15 font-black text-white/95 ${box} ${className}`}
      style={{ background: `linear-gradient(140deg, ${colors.from}, ${colors.to})` }}
      aria-hidden
    >
      <span className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(255,255,255,.22),transparent_65%)]" />
      <span className="relative tracking-tight">{initials(name)}</span>
    </span>
  );
}