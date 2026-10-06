import { z } from 'zod';

/** ISO-3166-1 alpha-2 */
export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(2)
  .regex(/^[A-Z]{2}$/, 'Must be a 2-letter ISO country code');

export const tokenSymbol = z.enum(['SOL', 'USDC']);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

const sqlSafe = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, hyphen and underscore');

// ---------------------------------------------------------------------------
// Public catalog (no auth)
// ---------------------------------------------------------------------------

export const catalogQuerySchema = z.object({
  country: countryCode.optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  category: sqlSafe.optional(),
  brand: sqlSafe.optional(),
  q: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().min(0).max(100_000).optional(),
  maxPrice: z.coerce.number().min(0).max(100_000).optional(),
  featured: z
    .union([z.literal('true'), z.literal('false'), z.literal(true), z.literal(false)])
    .transform((v) => v === true || v === 'true')
    .optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'name', 'newest', 'popular']).default('relevance'),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Orders (partner / storefront)
// ---------------------------------------------------------------------------

export const orderLineSchema = z.object({
  productSlug: sqlSafe,
  // Accepts `"50"`, `"50.00"` or `50` — normalised to a decimal string.
  denomination: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,8}(\.\d{1,4})?$/.test(v), 'Invalid denomination'),
  quantity: z.coerce.number().int().min(1).max(50),
});

export const createOrderSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().max(120).optional(),
  country: countryCode.optional(),
  token: tokenSymbol,
  lines: z.array(orderLineSchema).min(1).max(25),
  referralCode: z.string().trim().max(40).optional(),
  utm: z.record(z.string().max(200)).optional(),
  // Return the order to the caller instead of redirecting (REST partners).
  returnOrder: z.boolean().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200),
});

export const productUpsertSchema = z.object({
  slug: sqlSafe.optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(2000),
  categorySlug: sqlSafe,
  brandSlug: sqlSafe.optional(),
  provider: z.string().trim().min(2).max(40).default('mock'),
  externalId: z.string().trim().max(120).optional(),
  logoUrl: z.string().url().max(500).optional().nullable(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  defaultCurrency: z.string().length(3).default('USD'),
  regions: z.array(z.string().trim().max(32)).max(50).default([]),
  countries: z.array(countryCode).max(250).default([]),
  denominations: z
    .array(
      z.object({
        faceValue: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/),
        priceUsd: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/).optional(),
      }),
    )
    .min(1)
    .max(60),
  tiers: z.array(z.object({ minQuantity: z.number().int().min(1), discountBps: z.number().int().min(0).max(5000) })).max(10).default([]),
  totalStock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  trackStock: z.boolean().default(true),
  lowStockThreshold: z.coerce.number().int().min(0).max(1000).default(3),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  tags: z.array(z.string().trim().max(30)).max(20).default([]),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(100),
});

export const tenantUpsertSchema = z.object({
  slug: sqlSafe.min(2).max(40),
  name: z.string().trim().min(2).max(80),
  legalName: z.string().trim().max(160).optional(),
  supportEmail: emailSchema.optional(),
  defaultCountry: countryCode.default('US'),
  markupBps: z.coerce.number().int().min(-5000).max(20_000).default(500),
  minOrderUsd: z.coerce.number().min(0).max(100_000).default(5),
  maxOrderUsd: z.coerce.number().min(0).max(1_000_000).default(2000),
  orderTtlMinutes: z.coerce.number().int().min(5).max(1440).default(30),
  acceptedTokens: z.array(tokenSymbol).min(1).max(3).default(['SOL']),
  brand: z.record(z.any()).default({}),
  theme: z.record(z.any()).default({}),
  features: z.record(z.any()).default({}),
});

export const priceUpdateSchema = z.object({
  symbol: tokenSymbol,
  usd: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/),
  mint: z.string().max(64).optional(),
  source: z.string().max(60).optional(),
});

export const ftxRateSchema = z.object({
  pair: z.string().regex(/^[A-Z]{3}:[A-Z]{3,5}$/),
  rate: z.string().regex(/^\d{1,18}(\.\d{1,12})?$/),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type ProductUpsertInput = z.infer<typeof productUpsertSchema>;
export type TenantUpsertInput = z.infer<typeof tenantUpsertSchema>;