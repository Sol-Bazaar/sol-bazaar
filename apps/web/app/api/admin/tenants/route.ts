import { NextResponse } from 'next/server';
import { prisma } from '@solbazaar/db';
import { unauthorized, validationFailed, createLogger } from '@solbazaar/core';
import { safeCompare } from '@/lib/api-auth';

const log = createLogger({ service: 'api:admin:tenants' });

export const dynamic = 'force-dynamic';

function requireOperator(req: Request): Response | null {
  const token = process.env.OPERATOR_TOKEN;
  if (!token) {
    return NextResponse.json({ error: { code: 'not_configured', message: 'OPERATOR_TOKEN is not set' } }, { status: 501 });
  }
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!provided || !safeCompare(provided, token)) {
    throw unauthorized('Provide the operator token');
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/tenants - list all tenants
// ────────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const authErr = requireOperator(req);
  if (authErr) return authErr;

  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        legalName: true,
        supportEmail: true,
        baseDomain: true,
        defaultCountry: true,
        markupBps: true,
        minOrderUsd: true,
        maxOrderUsd: true,
        orderTtlMinutes: true,
        acceptedTokens: true,
        brand: true,
        theme: true,
        features: true,
        domains: { select: { hostname: true, isPrimary: true, verifiedAt: true } },
        apiKeys: { select: { id: true, name: true, prefix: true, scopes: true, rateLimitPerMin: true, lastUsedAt: true, disabledAt: true, expiresAt: true } },
        _count: { select: { orders: true, webhookEndpoints: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { data: tenants },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    log.error('tenants_list_failed', { err: (e as Error).message });
    throw Object.assign(new Error('Failed to list tenants'), { code: 'internal' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/admin/tenants - create a new tenant
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const authErr = requireOperator(req);
  if (authErr) return authErr;

  try {
    const body = await req.json();
    const {
      slug,
      name,
      status = 'DRAFT',
      legalName,
      supportEmail,
      baseDomain,
      defaultCountry = 'US',
      markupBps = 500,
      minOrderUsd = 5,
      maxOrderUsd = 2000,
      orderTtlMinutes = 30,
      acceptedTokens = ['SOL'],
      brand,
      theme,
      features,
    } = body;

    if (!slug || !name) {
      throw validationFailed('slug and name are required');
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw validationFailed('slug must be lowercase alphanumeric with hyphens only');
    }

    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw validationFailed('A tenant with this slug already exists');
    }

    const tenant = await prisma.tenant.create({
      data: {
        slug,
        name,
        status,
        legalName,
        supportEmail,
        baseDomain: baseDomain ?? 'localhost:3000',
        defaultCountry,
        markupBps,
        minOrderUsd,
        maxOrderUsd,
        orderTtlMinutes,
        acceptedTokens,
        brand: brand ?? {},
        theme: theme ?? {},
        features: features ?? {},
      },
    });

    log.info('tenant_created', { id: tenant.id, slug: tenant.slug });

    return NextResponse.json({ data: tenant }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && 'code' in e) throw e;
    log.error('tenant_create_failed', { err: (e as Error).message });
    throw Object.assign(new Error('Failed to create tenant'), { code: 'internal' });
  }
}