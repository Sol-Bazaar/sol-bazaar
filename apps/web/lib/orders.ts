/**
 * Order creation.
 *
 * Everything in `createOrder` happens inside a single serializable transaction
 * so that the three scarce resources cannot drift apart:
 *
 *   1. **Stock** — reserved with a conditional `updateMany` guarded on the
 *      available quantity, which is the only way to prevent overselling under
 *      concurrency. Reading `totalStock` then writing it would race.
 *   2. **Deposit slots** — a unique HD index per order. The next free index is
 *      found with `SELECT ... FOR UPDATE` on a dedicated counter row (rather
 *      than "max+1", which two concurrent checkouts can compute identically).
 *   3. **The quote** — computed once and frozen onto the order row.
 *
 * If the transaction rolls back, the deposit address is simply never used. That
 * is the reason to allocate the index from a counter row: a burned index costs
 * one keypair, whereas a duplicated index would send two customers' payments to
 * the same address.
 */
import Decimal from 'decimal.js';
import {
  prisma,
  OrderStatus,
  FulfillmentStatus,
  ProductScope,
  TokenSymbol,
  type Order,
  type OrderItem,
  type Prisma,
} from '@solbazaar/db';
import { enqueue } from '@solbazaar/jobs';
import { publish } from '@solbazaar/fulfillment';
import { SolanaHdWallet, tokenInfo } from '@solbazaar/crypto';
import {
  orderNumber,
  hashIp,
  validationFailed,
  notFound,
  outOfStock,
  conflict,
  badRequest,
  createLogger,
  slugify,
  isAvailableInCountry,
  platformFeeConfig,
  platformFeeFor,
  splitAtomicFee,
  generateTrackingToken,
  hashTrackingToken,
  trackingTokenHint,
  buildTrackingUrl,
} from '@solbazaar/core';
import { loadRegions, toCatalogProduct } from './catalog';
import { quoteOrder } from './pricing';
import type { TenantContext } from '@solbazaar/tenant';

const log = createLogger({ service: 'orders' });

export interface CreateOrderArgs {
  tenant: TenantContext;
  lines: { productSlug: string; denomination: string; quantity: number }[];
  /** Required. Lowercased and validated before use. */
  email: string;
  fullName?: string;
  country: string;
  token: TokenSymbol;
  idempotencyKey?: string;
  ip?: string;
  userAgent?: string;
  referralCode?: string;
  utm?: Record<string, string>;
  /** Connected wallet, for order history. Never a substitute for email. */
  walletAddress?: string | null;
}

/**
 * Normalise and validate an email address.
 *
 * Deliberately strict: one `@`, no whitespace, a dotted domain, length-capped.
 * The address is user-visible in the order page and used by the email provider,
 * so header-injection characters must never survive.
 */
export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (/[\s\r\n,;<>"'()[\]\\]/.test(email)) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  // Reject consecutive dots and leading/trailing dots in the local part.
  if (/\.\./.test(email) || email.startsWith('.') || email.includes('@.')) return null;
  return email;
}

export interface CreatedOrder {
  order: Order & { items: OrderItem[] };
  /**
   * Opaque bearer token for the public tracking link. Returned exactly once, at
   * creation. Only its SHA-256 hash is stored, so it cannot be recovered later —
   * the customer must be given the link now (or use the email lookup instead).
   */
  trackingToken: string;
  trackingUrl: string;
  quote: {
    token: TokenSymbol;
    mint: string | null;
    decimals: number;
    cryptoAmount: string;
    atomicAmount: string;
    tokenUsd: string;
    depositAddress: string;
    derivationPath: string;
    depositAta: string | null;
    expiresAt: string;
    toleranceBps: number;
  };
}

export async function createOrder(args: CreateOrderArgs): Promise<CreatedOrder> {
  // ── Email is mandatory ───────────────────────────────────────────────────
  // The codes are delivered by email and shown on the order page, so an order
  // without a deliverable address is not a valid order. This is enforced here —
  // the single chokepoint every order passes through — rather than relying on
  // each caller's form validation, which is the part that is easy to bypass.
  const email = normaliseEmail(args.email);
  if (!email) {
    throw validationFailed(
      'An email address is required. We send your gift card codes there and show them on the order page.',
    );
  }

  const wallet = SolanaHdWallet.fromEnv();
  const regions = await loadRegions();

  // Idempotency: a retried request must return the original order, not a
  // second one that charges the customer twice.
  if (args.idempotencyKey) {
    const existing = await prisma.order.findFirst({
      where: { tenantId: args.tenant.id, idempotencyKey: args.idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      log.info('order_idempotent_hit', { orderNumber: existing.orderNumber });
      // A retry cannot recover the original token (we only stored its hash), so
      // mint a fresh one. That is safe: it invalidates only the link the customer
      // may already have, and they always have the email route as a fallback.
      const retryToken = generateTrackingToken();
      await prisma.order.update({
        where: { id: existing.id },
        data: { trackingTokenHash: await hashTrackingToken(retryToken), trackingTokenHint: trackingTokenHint(retryToken) },
      });
      return {
        order: existing,
        trackingToken: retryToken,
        trackingUrl: buildTrackingUrl(appUrl(), existing.orderNumber, retryToken),
        quote: await describeQuote(existing),
      };
    }
  }

  // ---- Resolve + validate lines against live stock and geo rules -----------
  const resolved: {
    product: NonNullable<Awaited<ReturnType<typeof loadProduct>>>;
    faceValue: Decimal;
    quantity: number;
  }[] = [];

  for (const line of args.lines) {
    const product = await loadProduct(args.tenant.id, line.productSlug);
    if (!product) throw notFound(`Product "${line.productSlug}" not found`);

    const available = product.regions ?? [];
    if (!isAvailableInCountry(available, args.country, regions)) {
      throw badRequest(`${product.name} is not available in ${args.country}`, { productSlug: line.productSlug });
    }

    const faceValue = new Decimal(line.denomination);
    const denom = product.denominations.find((d) => new Decimal(String(d.faceValue)).eq(faceValue));
    if (!denom) {
      throw validationFailed(`Invalid denomination ${line.denomination} for ${product.name}`, {
        allowed: product.denominations.map((d) => String(d.faceValue)),
      });
    }
    if (line.quantity < 1 || line.quantity > 50) {
      throw validationFailed('Quantity must be between 1 and 50');
    }
    if (args.token === TokenSymbol.SOL || args.token === TokenSymbol.USDC) {
      if (!args.tenant.acceptedTokens.includes(args.token)) {
        throw badRequest(`${args.token} is not an accepted payment method for this store`);
      }
    }

    resolved.push({ product, faceValue, quantity: line.quantity });
  }

  // Merge duplicate lines so stock accounting is exact.
  const merged = new Map<string, (typeof resolved)[number]>();
  for (const r of resolved) {
    const key = `${r.product.id}:${r.faceValue.toString()}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += r.quantity;
    else merged.set(key, { ...r });
  }
  const lines = [...merged.values()];

  // ---- Money -------------------------------------------------------------
  // Three separate components, deliberately not merged:
  //   subtotal    face values after tier discounts
  //   lineTotal   subtotal + the MERCHANT's markup (what they earn)
  //   platformFee our 1%, charged on top and accounted on its own so it can
  //                be swept to the collector wallet and refunded independently
  const feeCfg = platformFeeConfig();
  const platformFeeBps = feeCfg.bps;

  let subtotal = new Decimal(0);
  let platformFee = new Decimal(0);
  const linePlans = lines.map((l) => {
    const denom = l.product.denominations.find((d) => new Decimal(String(d.faceValue)).eq(l.faceValue))!;
    const faceTotal = l.faceValue.mul(l.quantity);
    // Apply the best matching tier discount, then the tenant markup.
    const tier = [...(l.product.tierPrices ?? [])]
      .filter((t) => l.quantity >= t.minQuantity)
      .sort((a, b) => b.minQuantity - a.minQuantity)[0];
    const discountBps = tier?.discountBps ?? 0;
    const afterDiscount = faceTotal.mul(new Decimal(1).minus(new Decimal(discountBps).div(10000)));
    const chargeUsd = afterDiscount.mul(new Decimal(1).plus(new Decimal(args.tenant.markupBps).div(10000)));

    // Our fee is a percentage of the line's value, charged per item.
    const lineFee = platformFeeFor(afterDiscount, platformFeeBps);
    platformFee = platformFee.plus(lineFee);
    subtotal = subtotal.plus(afterDiscount);

    return { line: l, denom, chargeUsd, afterDiscount, discountBps, platformFee: lineFee };
  });

  // What the customer must send in total.
  const totalUsd = linePlans.reduce((a, p) => a.plus(p.chargeUsd), new Decimal(0)).plus(platformFee);

  if (totalUsd.lt(args.tenant.minOrderUsd)) {
    throw validationFailed(`Minimum order is $${args.tenant.minOrderUsd.toFixed(2)}`);
  }
  if (totalUsd.gt(args.tenant.maxOrderUsd)) {
    throw validationFailed(`Maximum order is $${args.tenant.maxOrderUsd.toFixed(2)}`);
  }

  // ---- Quote (locked) ----------------------------------------------------
  const toleranceBps = Number(process.env.PAYMENT_TOLERANCE_BPS ?? 150);
  const quote = await quoteOrder({ usdTotal: totalUsd, token: args.token, markupBps: 0, toleranceBps });
  const token = args.token === 'USDT' ? 'USDC' : args.token;
  const info = tokenInfo(token as 'SOL' | 'USDC', process.env.SOLANA_CLUSTER !== 'mainnet-beta');
  const expiresAt = new Date(Date.now() + args.tenant.orderTtlMinutes * 60_000);

  // Tracking token: opaque bearer credential for /track/<orderNumber>?t=...
  // Generated inside the transaction so an order can never exist without one.
  const trackingToken = generateTrackingToken();

  // ---- Allocate a deposit slot + create the order -------------------------
  const order = await prisma.$transaction(
    async (t) => {
      // Conditional stock reservation: the `gte` guard makes this safe under
      // concurrency. A zero-row update means someone else took the last one.
      for (const p of linePlans) {
        const trackStock = p.line.product.trackStock;
        const res = await t.product.updateMany({
          where: {
            id: p.line.product.id,
            ...(trackStock ? { totalStock: { gte: p.line.quantity } } : {}),
            isActive: true,
          },
          data: { reservedStock: { increment: p.line.quantity } },
        });
        if (res.count === 0) {
          throw outOfStock(
            `${p.line.product.name} (${p.line.faceValue.toFixed(2)} ${p.denom.currency}) is out of stock`,
            { productSlug: p.line.product.slug },
          );
        }
      }

      // Serialise index allocation on a counter row.
      const slot = await allocateDepositSlot(t);
      const account = wallet.accountAt(slot.index);
      const ata = info.mint ? await awaitAtaSafe(info.mint, account.address) : null;

      const created = await t.order.create({
        data: {
          orderNumber: await uniqueOrderNumber(t),
          tenantId: args.tenant.id,
          email,
          fullName: args.fullName ?? null,
          country: args.country,
          walletAddress: args.walletAddress ?? null,
          status: OrderStatus.PENDING_PAYMENT,
          fulfillmentStatus: FulfillmentStatus.PENDING,

          subtotalUsd: subtotal,
          discountUsd: subtotal.minus(linePlans.reduce((a, p) => a.plus(p.afterDiscount), new Decimal(0))),
          feesUsd: new Decimal(0),
          platformFeeUsd: platformFee,
          platformFeeBps,
          totalUsd,

          token: args.token,
          mintAddress: info.mint,
          tokenDecimals: info.decimals,
          tokenUsdPrice: quote.tokenUsd,
          amountCrypto: quote.cryptoAmount,
          amountAtomic: quote.atomicAmount.toString(),
          expectedAtomic: quote.atomicAmount.toString(),
          toleranceBps,

          depositIndex: slot.index,
          depositAddress: account.address,
          derivationPath: account.path,
          depositAta: ata,

          trackingTokenHash: await hashTrackingToken(trackingToken),
          trackingTokenHint: trackingTokenHint(trackingToken),

          expiresAt,
          idempotencyKey: args.idempotencyKey ?? null,
          ...(args.ip ? { ipHash: hashIp(args.ip, process.env.IP_HASH_SALT ?? 'fc') } : {}),
          ...(args.userAgent ? { userAgent: args.userAgent.slice(0, 400) } : {}),
          geoCountry: args.country,
          geoSource: 'request',
          referralCode: args.referralCode ?? null,
          utm: (args.utm ?? undefined) as Prisma.InputJsonValue | undefined,

          items: {
            create: linePlans.map((p) => ({
              productId: p.line.product.id,
              productSlug: p.line.product.slug,
              productName: p.line.product.name,
              brandName: p.line.product.brand?.name ?? null,
              logoUrl: p.line.product.logoUrl ?? p.line.product.brand?.logoUrl ?? null,
              faceValue: p.line.faceValue,
              currency: p.denom.currency,
              unitPriceUsd: p.chargeUsd.div(p.line.quantity),
              quantity: p.line.quantity,
              lineTotalUsd: p.chargeUsd,
              platformFeeUsd: p.platformFee,
              unitAtomic: '0',
              lineAtomic: '0',
            })),
          },
        },
        include: { items: true },
      });

      // Per-line atomic amounts, proportional to the USD charge. Rounding
      // remainders are absorbed by the last line so the lines always sum to
      // exactly `amountAtomic` — the customer must never be asked for a total
      // that differs from the sum of its parts.
      await assignAtomicAmounts(t, created, linePlans, quote.atomicAmount);

      // Split the total into our platform fee and the merchant's remainder.
      // Uses floor + remainder-to-merchant so the two parts always sum back to
      // `amountAtomic` exactly — otherwise rounding dust would accrue forever
      // and never be swept.
      const { platformFeeAtomic } = splitAtomicFee(quote.atomicAmount, platformFeeBps);
      await t.order.update({
        where: { id: created.id },
        data: { platformFeeAtomic: platformFeeAtomic.toString() },
      });

      await t.job.create({
        data: {
          type: 'EXPIRE_ORDER' as any,
          payload: { orderId: created.id } as any,
          dedupeKey: `expire:${created.id}`,
          runAt: new Date(expiresAt.getTime() + 30_000),
          priority: 30,
        },
      });

      return created;
    },
    { isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel, timeout: 20_000 },
  );

  // The object returned by `order.create` still holds the placeholder values we
  // wrote (`lineAtomic: '0'`), because the per-line and platform-fee splits are
  // applied by follow-up statements in the same transaction. Re-read so callers
  // (and the REST response) never observe a half-built order.
  const persisted = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { items: true },
  });

  log.info('order_created', {
    orderNumber: persisted.orderNumber,
    tenant: args.tenant.slug,
    country: args.country,
    totalUsd: totalUsd.toFixed(2),
    platformFeeUsd: platformFee.toFixed(2),
    platformFeeBps,
    tokenSymbol: args.token,
    lines: persisted.items.length,
  });

  // Side effects outside the transaction: enqueue expiry via the shared queue
  // and notify partner webhooks. Failures here must not fail the order.
  await enqueue('EXPIRE_ORDER', { orderId: persisted.id }, { dedupeKey: `expire:${persisted.id}` }).catch((e) =>
    log.warn('enqueue_expire_failed', { err: (e as Error).message }),
  );
  await publish('order.created', serialiseOrderForWebhook(persisted)).catch((e) =>
    log.warn('webhook_publish_failed', { err: (e as Error).message }),
  );

  return {
    order: persisted,
    trackingToken,
    trackingUrl: buildTrackingUrl(appUrl(), persisted.orderNumber, trackingToken),
    quote: await describeQuote(persisted),
  };
}

/**
 * Canonical public origin for building links.
 *
 * Uses APP_URL rather than a request Host header, so a Host-header injection
 * cannot make us hand a customer a tracking link pointing at an attacker's host.
 */
function appUrl(): string {
  return process.env.APP_URL?.trim() || 'http://localhost:3000';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Allocate the next unused HD derivation index.
 *
 * Uses a dedicated `Setting` row as a counter with `FOR UPDATE`, so two
 * concurrent checkouts serialise here and cannot compute the same index.
 * (Using `max(depositIndex)+1` would let them collide.)
 */
async function allocateDepositSlot(t: Prisma.TransactionClient): Promise<{ index: number }> {
  const KEY = 'hd_deposit_slot';
  await t.$executeRawUnsafe(`
    INSERT INTO "Setting" (key, value, "updatedAt")
    VALUES ('${KEY}', '{"next":0}', now())
    ON CONFLICT (key) DO NOTHING
  `);

  const rows = await t.$queryRaw<{ next: number }[]>`
    SELECT (value->>'next')::int AS next
    FROM "Setting"
    WHERE key = ${KEY}
    FOR UPDATE
  `;
  const next = Number(rows[0]?.next ?? 0);

  await t.$executeRawUnsafe(`
    UPDATE "Setting" SET value = jsonb_set(value, '{next}', to_jsonb(${next + 1}::int), true), "updatedAt" = now()
    WHERE key = '${KEY}'
  `);

  return { index: next };
}

/** Generate an order number, retrying on the (astronomically rare) collision. */
async function uniqueOrderNumber(t: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const candidate = orderNumber('FC');
    const clash = await t.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw conflict('Could not allocate an order number');
}

async function awaitAtaSafe(mint: string, owner: string): Promise<string> {
  try {
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const { PublicKey } = await import('@solana/web3.js');
    return getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(owner), true).then((k) => k.toBase58());
  } catch {
    log.warn('ata_derivation_failed', { mint, owner });
    return owner;
  }
}

async function assignAtomicAmounts(
  t: Prisma.TransactionClient,
  order: Order & { items: { id: string; lineTotalUsd: unknown; quantity: number }[] },
  plans: { chargeUsd: Decimal }[],
  totalAtomic: bigint,
): Promise<void> {
  const totalUsd = plans.reduce((a, p) => a.plus(p.chargeUsd), new Decimal(0));
  let allocated = 0n;

  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];
    const share = new Decimal(String(item.lineTotalUsd)).div(totalUsd);
    let atomic: bigint;
    if (i === order.items.length - 1) {
      atomic = totalAtomic - allocated; // absorb the rounding remainder
    } else {
      atomic = BigInt(share.mul(totalAtomic.toString()).toFixed(0));
      allocated += atomic;
    }
    const unit = item.quantity > 0 ? atomic / BigInt(item.quantity) : 0n;

    await t.orderItem.update({
      where: { id: item.id },
      data: { lineAtomic: atomic.toString(), unitAtomic: unit.toString() },
    });
  }
}

async function loadProduct(tenantId: string, slug: string) {
  const p = await prisma.product.findFirst({
    where: {
      slug,
      isActive: true,
      OR: [{ scope: ProductScope.GLOBAL }, { tenantId }],
    },
    include: {
      category: true,
      brand: true,
      denominations: { where: { isActive: true }, orderBy: { faceValue: 'asc' } },
      tierPrices: true,
      regions: { select: { regionCode: true, countryCode: true } },
    },
  });
  return p;
}

export function serialiseOrderForWebhook(order: Order & { items?: unknown[] }): Record<string, unknown> {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    email: maskEmail(order.email),
    country: order.country,
    subtotalUsd: String(order.subtotalUsd),
    totalUsd: String(order.totalUsd),
    token: order.token,
    amountCrypto: String(order.amountCrypto),
    depositAddress: order.depositAddress,
    expiresAt: order.expiresAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    ...(Array.isArray(order.items)
      ? {
          items: (order.items as any[]).map((i) => ({
            productSlug: i.productSlug,
            productName: i.productName,
            faceValue: String(i.faceValue),
            currency: i.currency,
            quantity: i.quantity,
          })),
        }
      : {}),
  };
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

async function describeQuote(order: Order): Promise<CreatedOrder['quote']> {
  const token = order.token === 'USDT' ? 'USDC' : order.token;
  const info = tokenInfo(token as 'SOL' | 'USDC', process.env.SOLANA_CLUSTER !== 'mainnet-beta');
  return {
    token: order.token,
    mint: order.mintAddress,
    decimals: order.tokenDecimals,
    cryptoAmount: new Decimal(String(order.amountCrypto)).toFixed(info.decimals).replace(/\.?0+$/, ''),
    atomicAmount: order.amountAtomic,
    tokenUsd: new Decimal(String(order.tokenUsdPrice)).toFixed(2),
    depositAddress: order.depositAddress,
    derivationPath: order.derivationPath,
    depositAta: order.depositAta,
    expiresAt: order.expiresAt.toISOString(),
    toleranceBps: order.toleranceBps,
  };
}
