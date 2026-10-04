/**
 * Order email delivery.
 *
 * Uses plain `fetch` against an HTTP email API (Resend/Postmark/SES) so there is
 * no heavyweight SDK dependency. When no provider key is configured we fall back
 * to logging the codes — safe for development, loudly warned in production so
 * nobody ships a live store with no delivery path.
 *
 * Note: codes are emailed in plaintext by necessity (that is the product). The
 * email body therefore never gets stored, and the message is not retried once
 * delivered so a webhook replay cannot duplicate it.
 */
import { prisma, OrderStatus } from '@solbazaar/db';
import { createLogger, formatUsd } from '@solbazaar/core';
import { revealCodes } from './fulfill';
import type { RevealedCode } from './fulfill';

const log = createLogger({ service: 'email' });

export interface EmailResult {
  sent: boolean;
  provider: 'resend' | 'postmark' | 'console' | 'none';
  messageId?: string;
  error?: string;
}

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function dispatch(msg: EmailMessage): Promise<EmailResult> {
  const key = process.env.EMAIL_API_KEY;

  if (key && process.env.EMAIL_PROVIDER === 'resend') {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? 'Sol Bazaar <orders@solbazaar.com>',
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { sent: false, provider: 'resend', error: json.message ?? `HTTP ${res.status}` };
      return { sent: true, provider: 'resend', messageId: json.id };
    } catch (e) {
      return { sent: false, provider: 'resend', error: (e as Error).message };
    }
  }

  if (key && process.env.EMAIL_PROVIDER === 'postmark') {
    try {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          From: process.env.EMAIL_FROM ?? 'orders@solbazaar.com',
          To: msg.to,
          Subject: msg.subject,
          HtmlBody: msg.html,
          TextBody: msg.text,
          MessageStream: 'outbound',
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string };
      if (!res.ok) return { sent: false, provider: 'postmark', error: json.Message ?? `HTTP ${res.status}` };
      return { sent: true, provider: 'postmark', messageId: json.MessageID };
    } catch (e) {
      return { sent: false, provider: 'postmark', error: (e as Error).message };
    }
  }

  // No provider configured.
  if (process.env.NODE_ENV === 'production') {
    log.error('no_email_provider', { to: msg.to, hint: 'Configure EMAIL_PROVIDER + EMAIL_API_KEY' });
    return { sent: false, provider: 'none', error: 'No email provider configured' };
  }
  log.warn('email_console_fallback', { to: msg.to, subject: msg.subject });
  return { sent: true, provider: 'console' };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Absolute URL for the logo in an email.
 *
 * Email clients will not load a relative `src`, and many block remote images
 * outright — so this is best-effort: the brand name is already in the subject
 * line and the `alt` text, which is what a blocked image degrades to.
 *
 * Tenants set `brand.logoUrl` to their own asset; the house storefront uses the
 * bundled mark. An already-absolute tenant URL is passed through untouched —
 * prefixing it would produce `https://site/https://…`.
 */
function brandLogoUrl(logoUrl: string | null | undefined): string {
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const v = (logoUrl ?? '').trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/')) return `${base}${v}`;
  return `${base}/brand/logo-112.png`;
}

/**
 * Code-delivery email.
 *
 * Email clients strip `<style>` blocks inconsistently and many render in dark
 * mode, so everything is inline and the palette is fixed light. The codes are
 * the only thing that matters here, so the design is deliberately plain: one
 * border, one header, monospace codes, generous tap targets.
 */
function codesHtml(
  codes: RevealedCode[],
  brandName: string,
  supportEmail: string,
  logoUrl?: string | null,
): string {
  const rows = codes
    .map(
      (c) => `<tr>
        <td style="padding:14px 16px;border-bottom:1px solid #E9E9EC;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;font-weight:700;letter-spacing:.4px;color:#0A0A0A">
          ${esc(c.code)}
          ${c.pin ? `<div style="font-size:13px;color:#6B6B72;font-weight:500">PIN ${esc(c.pin)}</div>` : ''}
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid #E9E9EC;text-align:right;font-size:14px;color:#6B6B72;white-space:nowrap">
          ${c.faceValue ? `${esc(c.currency ?? 'USD')} ${formatUsd(c.faceValue)}` : ''}
        </td>
      </tr>`,
    )
    .join('');

  return `<!doctype html><html><body style="margin:0;background:#F7F7F8;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(10,10,10,.08)">
      <tr><td style="padding:22px 28px;border-bottom:1px solid #E9E9EC">
        <img src="${brandLogoUrl(logoUrl)}" alt="${esc(brandName)}" width="28" height="43" style="display:block;border:0;width:28px;height:43px" />
      </td></tr>
      <tr><td style="padding:30px 28px 8px">
        <h1 style="margin:0 0 10px;font-size:22px;line-height:1.2;font-weight:500;letter-spacing:-.4px;color:#0A0A0A">Your gift cards are ready</h1>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#6B6B72">
          Payment confirmed on Solana. Redeem these codes immediately — most gift cards have no expiry, but value can be stolen if the code leaks.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E9E9EC;border-radius:8px;overflow:hidden">
          ${rows}
        </table>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#8A8A8F">
          Keep this email. You can also view your codes any time at your order page using order number <strong style="color:#0A0A0A">${esc('{{ORDER_NUMBER}}')}</strong> and this email address.
        </p>
      </td></tr>
      <tr><td style="padding:18px 28px 30px">
        <div style="font-size:12px;color:#8A8A8F;border-top:1px solid #E9E9EC;padding-top:16px">
          Questions? Reply to this email or contact <a href="mailto:${esc(supportEmail)}" style="color:#0A0A0A">${esc(supportEmail)}</a>.
        </div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function codesText(codes: RevealedCode[], brandName: string, orderNumber: string): string {
  const lines = codes.map((c, i) => `${i + 1}. ${c.code}${c.pin ? ` (PIN ${c.pin})` : ''}${c.faceValue ? ` — ${c.currency ?? 'USD'} ${c.faceValue}` : ''}`);
  return `${brandName}\n\nYour gift cards are ready.\nOrder ${orderNumber}\n\n${lines.join('\n')}\n\nKeep this email safe — anyone with the codes can redeem them.`;
}

/**
 * Deliver the codes for a completed order and record the SLA.
 *
 * Idempotent: the job's `dedupeKey` collapses repeats, and `emailSentAt` is
 * only set once. On success we stamp `emailSentAt` and compute
 * `deliveryLatencyMs` (paidAt -> email sent), which is the number the platform
 * holds itself to. On failure we increment `emailAttempts` and store the reason
 * so the order page can warn the customer *before* they go looking in their
 * inbox — the codes are still readable on the order page either way, which is
 * the important part.
 */
export async function deliverOrderEmail(orderId: string): Promise<EmailResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { tenant: true, items: true },
  });
  if (!order) return { sent: false, provider: 'none', error: 'order_not_found' };
  if (order.status !== OrderStatus.COMPLETED) {
    return { sent: false, provider: 'none', error: `order_not_completed (${order.status})` };
  }
  // Already delivered — do not send a second copy.
  if (order.emailSentAt) {
    log.debug('email_already_sent', { orderNumber: order.orderNumber });
    return { sent: true, provider: 'console', messageId: 'already-sent' };
  }

  const codes = await revealCodes(orderId);
  if (!codes.length) {
    // Codes not yet written. Throw so the queue retries with backoff rather than
    // dropping the email on the floor.
    throw new Error('codes not yet available for delivery');
  }

  const brand = (order.tenant.brand as { name?: string; logoUrl?: string } | null) ?? {};
  const brandName = brand.name ?? order.tenant.name;
  const supportEmail =
    (order.tenant.brand as { supportEmail?: string } | null)?.supportEmail ??
    order.tenant.supportEmail ??
    'support@solbazaar.com';

  const html = codesHtml(codes, brandName, supportEmail, brand.logoUrl).replace('{{ORDER_NUMBER}}', esc(order.orderNumber));
  const text = codesText(codes, brandName, order.orderNumber);

  const result = await dispatch({
    to: order.email,
    subject: `${brandName} — your ${codes.length} gift card${codes.length > 1 ? 's are' : ' is'} ready`,
    html,
    text,
  });

  const now = new Date();
  if (result.sent) {
    // Customer-visible latency: payment confirmed -> codes in their inbox.
    const latency = order.paidAt ? now.getTime() - order.paidAt.getTime() : null;
    await prisma.order
      .update({
        where: { id: orderId },
        data: {
          emailSentAt: now,
          emailAttempts: { increment: 1 },
          emailError: null,
          deliveryLatencyMs: latency,
        },
      })
      .catch(() => undefined);

    const p95 = latency != null && latency > SLA_MS;
    log[p95 ? 'warn' : 'info']('order_email', {
      orderNumber: order.orderNumber,
      provider: result.provider,
      messageId: result.messageId,
      codeCount: codes.length,
      latencyMs: latency,
      slaMs: SLA_MS,
      breachedSla: p95,
    });
  } else {
    await prisma.order
      .update({
        where: { id: orderId },
        data: { emailAttempts: { increment: 1 }, emailError: result.error?.slice(0, 300) ?? 'unknown' },
      })
      .catch(() => undefined);

    log.error('order_email_failed', {
      orderNumber: order.orderNumber,
      provider: result.provider,
      err: result.error,
      note: 'codes remain available on the order page and tracking link',
    });
  }

  return result;
}

/** Our delivery promise: codes in the inbox in under four minutes. */
export const SLA_MS = 4 * 60 * 1000;

/** Order-confirmation email (sent before codes exist, on payment). */
export async function sendOrderConfirmation(orderId: string): Promise<EmailResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { tenant: true, items: true } });
  if (!order) return { sent: false, provider: 'none', error: 'order_not_found' };

  const brandName = (order.tenant.brand as { name?: string } | null)?.name ?? order.tenant.name;
  const total = order.items.reduce((a, i) => a + Number(i.lineTotalUsd), 0);

  const html = `<!doctype html><html><body style="margin:0;background:#F7F7F8;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E9E9EC;padding:28px">
      <tr><td>
        <h1 style="margin:0 0 14px;font-size:20px;font-weight:500;letter-spacing:-.3px;color:#0A0A0A">Payment received</h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#6B6B72">
          Order <strong style="color:#0A0A0A">${esc(order.orderNumber)}</strong> for
          <strong style="color:#0A0A0A">${formatUsd(total)}</strong> was confirmed on Solana.
          Your gift card code${order.items.length > 1 ? 's are' : ' is'} being generated and will arrive in a separate email within a minute.
        </p>
        <p style="margin:0;font-size:13px;color:#8A8A8F">— ${esc(brandName)}</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  return dispatch({
    to: order.email,
    subject: `${brandName} — payment confirmed (${order.orderNumber})`,
    html,
    text: `Payment received for order ${order.orderNumber} (${formatUsd(total)}). Your gift card code is on its way.`,
  });
}