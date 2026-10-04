/**
 * Turn a TenantContext into the CSS custom properties + Tailwind config the
 * storefront renders with. Keeping this server-side means each white-label
 * brand is fully SSR'd with correct colours in the first HTML response (good
 * for perceived load and avoids a flash of unstyled brand).
 */
import type { BrandConfig, TenantContext, ThemeConfig } from './resolve';

export interface ResolvedTheme {
  accent: string;
  accent2: string;
  background: string;
  surface: string;
  /** Hover / raised surface — one step above `surface`. */
  elevated: string;
  /** Input and field backgrounds. Deliberately *darker* than `surface`. */
  field: string;
  /** Hairline borders on a single element. */
  line: string;
  /** Structural grid lines. Lighter than `line` because always visible. */
  grid: string;
  text: string;
  muted: string;
  faint: string;
  ok: string;
  warn: string;
  bad: string;
  /** Money values. Reserved: colour here always means "this is an amount". */
  money: string;
  /** 0 in the default theme; kept so a tenant can opt into rounded corners. */
  radius: number;
  /** Grid cell size in px. Must match the layout gutter to look continuous. */
  cell: number;
  mode: 'dark' | 'light';
}

export interface ResolvedBrand {
  name: string;
  legalName: string;
  logoText: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  tagline: string;
  supportEmail: string;
  supportUrl: string | null;
  accent: string;
  accent2: string;
  heroHeadline: string;
  heroSubhead: string;
  announcement: string;
}

export const DEFAULT_BRAND: ResolvedBrand = {
  name: 'Sol Bazaar',
  legalName: 'Sol Bazaar Ltd',
  logoText: 'Sol Bazaar',
  /**
   * Trimmed to the artwork and given real alpha by `scripts/build-brand-assets.ts`.
   * A white-label tenant overrides this; the house storefront ships the mark.
   *
   * The mark is portrait (899x1374), so render it sized by *height* with an
   * automatic width. A fixed square box would letterbox it down to roughly half
   * the intended size.
   */
  logoUrl: '/brand/logo-112.png',
  faviconUrl: '/brand/favicon-48.png',
  tagline: 'Gift cards, paid with crypto.',
  supportEmail: 'support@solbazaar.com',
  supportUrl: null,
  // White. The house brand is deliberately colourless — a gift-card marketplace
  // shows dozens of third-party brand colours in every grid, so the chrome has
  // to stay neutral or the page reads as noise. Tenants can override.
  accent: '#FFFFFF',
  accent2: '#F5F2EC',
  heroHeadline: 'Live on Crypto, Go Bankless',
  heroSubhead:
    'Instant digital delivery. Pay with SOL or USDC on Solana — settled on-chain in seconds, no bank account required.',
  announcement: '',
};

/**
 * Palette.
 *
 * Near-black with a faint violet cast rather than a neutral grey-black — it sits
 * under the brand mark's purple→teal→green gradient without competing with it.
 *
 * `text` is a warm off-white (`#EFEFE5`), not pure white. Pure white on true
 * black is harsh and makes the hairline grid vibrate; a cream-white reads calmer
 * and lets `#FFFFFF` stay available as a genuine emphasis colour.
 *
 * `--grid` is the important one: it is *lighter* than `--line`, because the grid
 * is structural (always visible) while lines are local (borders on one cell).
 */
const DARK = {
  background: '#0A090F',
  surface: '#0F0E15',
  elevated: '#16151D',
  field: '#0C0B11',
  line: '#22212B',
  grid: '#353539',
  text: '#EFEFE5',
  muted: '#93948F',
  faint: '#5A5B5F',
  ok: '#4ADE4A',
  warn: '#E0A82E',
  bad: '#E66565',
  money: '#3BE06B',
} as const;

const LIGHT = {
  background: '#FFFFFF',
  surface: '#FAFAF8',
  elevated: '#F0F0EC',
  field: '#F4F4F2',
  line: '#E2E2DE',
  grid: '#D4D4D0',
  text: '#0A090F',
  muted: '#6B6B70',
  faint: '#A0A0A4',
  ok: '#16A34A',
  warn: '#B45309',
  bad: '#DC2626',
  money: '#0F8A00',
} as const;

/**
 * Grid cell size, in px.
 *
 * One token because the background gradients and the layout gutters have to
 * agree — a 24px cell with 24px gaps is what makes cells read as a continuous
 * drawing rather than as a table.
 */
const CELL = 24;

export function resolveTheme(tenant: Pick<TenantContext, 'brand' | 'theme'>): ResolvedTheme {
  const b = tenant.brand ?? {};
  const t = tenant.theme ?? {};
  const mode = t.mode === 'light' ? 'light' : 'dark';
  const p = mode === 'light' ? LIGHT : DARK;
  return {
    accent: b.accent ?? DEFAULT_BRAND.accent,
    accent2: b.accent2 ?? DEFAULT_BRAND.accent2,
    background: p.background,
    surface: p.surface,
    elevated: p.elevated,
    field: p.field,
    line: p.line,
    grid: p.grid,
    text: p.text,
    muted: p.muted,
    faint: p.faint,
    ok: p.ok,
    warn: p.warn,
    bad: p.bad,
    money: p.money,
    // Square. This design has no rounded corners; `radius` exists only so a
    // tenant that wants them can ask, and so `--radius` still resolves.
    radius: t.radius ?? 0,
    cell: CELL,
    mode,
  };
}

/** Serialize theme vars for inline use in `<html style={...}>`. */
export function themeStyle(theme: ResolvedTheme): Record<string, string> {
  return {
    '--accent': theme.accent,
    '--accent-2': theme.accent2,
    '--bg': theme.background,
    '--surface': theme.surface,
    '--elevated': theme.elevated,
    '--field': theme.field,
    '--line': theme.line,
    '--grid': theme.grid,
    '--text': theme.text,
    '--muted': theme.muted,
    '--faint': theme.faint,
    '--ok': theme.ok,
    '--warn': theme.warn,
    '--bad': theme.bad,
    '--money': theme.money,
    '--radius': `${theme.radius}px`,
    '--cell': `${theme.cell}px`,
  } as Record<string, string>;
}

export function brandOrDefaults(
  tenant: Pick<TenantContext, 'brand' | 'name'> & Partial<Pick<TenantContext, 'legalName' | 'supportEmail'>>,
): ResolvedBrand {
  const b = (tenant.brand ?? {}) as BrandConfig;
  return {
    name: b.name ?? tenant.name ?? DEFAULT_BRAND.name,
    legalName: b.legalName ?? tenant.legalName ?? DEFAULT_BRAND.legalName,
    logoText: b.logoText ?? b.name ?? tenant.name ?? DEFAULT_BRAND.logoText,
    logoUrl: b.logoUrl ?? DEFAULT_BRAND.logoUrl,
    faviconUrl: b.faviconUrl ?? DEFAULT_BRAND.faviconUrl,
    tagline: b.tagline ?? DEFAULT_BRAND.tagline,
    supportEmail: b.supportEmail ?? tenant.supportEmail ?? DEFAULT_BRAND.supportEmail,
    supportUrl: b.supportUrl ?? DEFAULT_BRAND.supportUrl,
    accent: b.accent ?? DEFAULT_BRAND.accent,
    accent2: b.accent2 ?? DEFAULT_BRAND.accent2,
    heroHeadline: b.heroHeadline ?? DEFAULT_BRAND.heroHeadline,
    heroSubhead: b.heroSubhead ?? DEFAULT_BRAND.heroSubhead,
    announcement: b.announcement ?? DEFAULT_BRAND.announcement,
  };
}

export type { BrandConfig, TenantContext, ThemeConfig };