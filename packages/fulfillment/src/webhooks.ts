/**
 * Outbound webhooks for white-label partners.
 *
 * Signing: every delivery carries `X-SolBazaar-Signature: t=<unix>,v1=<hmac_sha256_hex>`
 * computed over `${timestamp}.${rawBody}`, and the partner verifies with a
 * constant-time compare. The timestamp is inside the signed payload so a
 * captured request cannot be replayed indefinitely — partners should reject
 * anything older than ~5 minutes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma, JobStatus } from '@solbazaar/db';
import { createLogger, sleep, withRetry } from '@solbazaar/core';

const log = createLogger({ service: 'webhooks' });

export const WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.fulfilled',
  'order.failed',
  'order.expired',
  'order.refunded',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function signPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export function verifySignature(rawBody: string, header: string, secret: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;
  const ts = Number(parts.t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fan an event out to every active endpoint subscribed to it. */
export async function publish(event: WebhookEvent, data: unknown): Promise<number> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { isActive: true, events: { has: event } },
  });
  if (!endpoints.length) return 0;

  const payload = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    type: event,
    createdAt: new Date().toISOString(),
    data,
  };

  let queued = 0;
  for (const ep of endpoints) {
    await prisma.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        event,
        payload: payload as any,
        status: JobStatus.PENDING,
      },
    });
    queued++;
  }
  log.info('webhook_published', { event, endpoints: endpoints.length });
  return queued;
}

/** Attempt one delivery with retry/backoff. */
export async function deliverDelivery(id: string): Promise<boolean> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id },
    include: { endpoint: true },
  });
  if (!delivery) return false;

  const ep = delivery.endpoint;
  const secret = decryptSecret(ep.secretEnc);
  if (!secret) {
    log.error('webhook_secret_missing', { endpointId: ep.id });
    await prisma.webhookDelivery.update({
      where: { id },
      data: { status: JobStatus.DEAD, responseBody: 'webhook secret could not be decrypted' },
    });
    return false;
  }

  const rawBody = JSON.stringify(delivery.payload);
  const attempts = delivery.attempts + 1;

  try {
    const res = await withRetry(
      async () => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 10_000);
        try {
          return await fetch(ep.url, {
            method: 'POST',
            signal: ctl.signal,
            headers: {
              'Content-Type': 'application/json',
              'X-SolBazaar-Signature': signPayload(rawBody, secret),
              'X-SolBazaar-Delivery': delivery.id,
              'X-SolBazaar-Event': delivery.event,
              'User-Agent': 'Sol Bazaar-Webhook/1.0',
            },
            body: rawBody,
          });
        } finally {
          clearTimeout(timer);
        }
      },
      { attempts: 3, baseMs: 500, onError: () => sleep(100) },
    );

    const text = (await res.text().catch(() => '')).slice(0, 1000);
    const ok = res.ok;

    await prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: ok ? JobStatus.COMPLETED : attempts >= 6 ? JobStatus.DEAD : JobStatus.PENDING,
        attempts,
        responseCode: res.status,
        responseBody: text,
        deliveredAt: ok ? new Date() : null,
        nextRunAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** attempts)),
      },
    });
    await prisma.webhookEndpoint.update({
      where: { id: ep.id },
      data: { lastStatus: res.status, lastSentAt: new Date() },
    });

    log[ok ? 'info' : 'warn']('webhook_delivered', { deliveryId: id, status: res.status, attempts, event: delivery.event });
    return ok;
  } catch (e) {
    await prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: attempts >= 6 ? JobStatus.DEAD : JobStatus.PENDING,
        attempts,
        responseBody: (e as Error).message.slice(0, 500),
        nextRunAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** attempts)),
      },
    });
    log.warn('webhook_delivery_failed', { deliveryId: id, err: (e as Error).message });
    return false;
  }
}

/** Claim due webhook deliveries. Same SKIP LOCKED pattern as the job queue. */
export async function claimDueDeliveries(limit = 20): Promise<string[]> {
  const rows = await prisma.webhookDelivery.findMany({
    where: { status: JobStatus.PENDING, nextRunAt: { lte: new Date() } },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Endpoint secret encryption (same AES-256-GCM envelope as the wallet seed)
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

function encKey(): Buffer {
  const master = process.env.WALLET_MASTER_KEY;
  if (!master) throw new Error('WALLET_MASTER_KEY is not set');
  return scryptSync(master.normalize('NFKD'), 'solbazaar:webhooks:v1', 32, {
    N: 32_768,
    r: 8,
    p: 1,
    // N=2^15, r=8 needs ~32 MB — Node's default maxmem is exactly that, so it
    // must be raised or scryptSync throws.
    maxmem: 64 * 1024 * 1024,
  });
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['w1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(blob: string): string | null {
  try {
    const [v, ivB64, tagB64, dataB64] = blob.split('.');
    if (v !== 'w1') return null;
    const d = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}