import { NextResponse } from 'next/server';
import { prisma } from '@solbazaar/db';
import { unauthorized, validationFailed, createLogger, notFound } from '@solbazaar/core';
import { safeCompare } from '@/lib/api-auth';

const log = createLogger({ service: 'api:admin:tenant' });

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
// GET /api/admin/tenants/[id] - get a single tenant
// ────────────────────────────────────────────────────────────────────────────
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireOperator(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
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
        domains: { select: { id: true, hostname: true, isPrimary: true, verifiedAt: true, createdAt: true } },
        apiKeys: { select: { id: true, name: true, prefix: true, scopes: true, rateLimitPerMin: true, lastUsedAt: true, disabledAt: true, expiresAt: true, createdAt: true } },
        _count: { select: { orders: true, webhookEndpoints: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      throw notFound('Tenant not found');
    }

    return NextResponse.json(
      { data: tenant },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof Error && 'code' in e) throw e;
    log.error('tenant_get_failed', { err: (e as Error).message });
    throw Object.assign(new Error('Failed to get tenant'), { code: 'internal' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/tenants/[id] - update a tenant
// ────────────────────────────────────────────────────────────────────────────
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireOperator(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) {
      throw notFound('Tenant not found');
    }

    const {
      slug,
      name,
      status,
      legalName,
      supportEmail,
      baseDomain,
      defaultCountry,
      markupBps,
      minOrderUsd,
      maxOrderUsd,
      orderTtlMinutes,
      acceptedTokens,
      brand,
      theme,
      features,
    } = body;

    if (slug && slug !== existing.slug) {
      if (!/^[a-z0-9-]+$/.test(slug)) {
        throw validationFailed('slug must be lowercase alphanumeric with hyphens only');
      }
      const dup = await prisma.tenant.findUnique({ where: { slug } });
      if (dup) {
        throw validationFailed('A tenant with this slug already exists');
      }
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(slug && { slug }),
        ...(name && { name }),
        ...(status && { status }),
        ...(legalName !== undefined && { legalName }),
        ...(supportEmail !== undefined && { supportEmail }),
        ...(baseDomain !== undefined && { baseDomain }),
        ...(defaultCountry && { defaultCountry }),
        ...(typeof markupBps === 'number' && { markupBps }),
        ...(typeof minOrderUsd === 'number' && { minOrderUsd }),
        ...(typeof maxOrderUsd === 'number' && { maxOrderUsd }),
        ...(typeof orderTtlMinutes === 'number' && { orderTtlMinutes }),
        ...(acceptedTokens && { acceptedTokens }),
        ...(brand !== undefined && { brand }),
        ...(theme !== undefined && { theme }),
        ...(features !== undefined && { features }),
      },
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
        createdAt: true,
        updatedAt: true,
      },
    });

    log.info('tenant_updated', { id: tenant.id, slug: tenant.slug });

    return NextResponse.json({ data: tenant });
  } catch (e) {
    if (e instanceof Error && 'code' in e) throw e;
    log.error('tenant_update_failed', { err: (e as Error).message });
    throw Object.assign(new Error('Failed to update tenant'), { code: 'internal' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/tenants/[id] - delete a tenant
// ────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireOperator(req);
  if (authErr) return authErr;

  try {
    const { id } = await params;

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) {
      throw notFound('Tenant not found');
    }

    // Check for related data
    const orderCount = await prisma.order.count({ where: { tenantId: id } });
    if (orderCount > 0) {
      throw validationFailed(`Cannot delete tenant with ${orderCount} orders. Suspend instead.`);
    }

    await prisma.tenant.delete({ where: { id } });

    log.info('tenant_deleted', { id, slug: existing.slug });

    return NextResponse.json({ data: { deleted: true } });
  } catch (e) {
    if (e instanceof Error && 'code' in e) throw e;
    log.error('tenant_delete_failed', { err: (e as Error).message });
    throw Object.assign(new Error('Failed to delete tenant'), { code: 'internal' });
  }
}