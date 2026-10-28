// POST /api/gift-delivery — Hayli-only processor for due, durable scheduled
// gift-certificate deliveries. Scheduling and email delivery are separate from
// Stripe issuance: a paid scheduled gift remains pending here until processed.
//
// The endpoint is intentionally owner-triggered (or cron-triggered with the
// same owner secret) because the current Pages deployment has no scheduler.
// A dry run is available for verification and must not send email.

import { buildGiftCertificateEmail } from '../../src/lib/gift/delivery.ts';
import { giftBucket, lookupGiftCertificate, type GiftStorageEnv } from '../../src/lib/gift/ledger.ts';
import {
  cancelScheduledGiftDelivery,
  listScheduledGiftDeliveries,
  markScheduledGiftDelivery,
} from '../../src/lib/gift/scheduled-delivery.ts';
import { constantTimeEqual, ownerTokenFromAuthorization } from './photo-auth.ts';

interface Env extends GiftStorageEnv {
  GIFT_OWNER_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_SITE_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function centralToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

function centralMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.GIFT_OWNER_TOKEN?.trim() || '';
  return Boolean(expected && constantTimeEqual(ownerTokenFromAuthorization(request), expected));
}

async function sendScheduledEmail(
  env: Env,
  input: {
    code: string;
    valueUsd: number;
    recipientName: string;
    recipientEmail: string;
    purchaserName: string;
    message?: string;
    paidAtIso: string;
  },
): Promise<boolean> {
  if (!env.RESEND_API_KEY?.trim()) return false;
  const siteUrl = env.PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://sparkling-standard.com';
  const email = buildGiftCertificateEmail({
    code: input.code,
    valueUsd: input.valueUsd,
    recipientName: input.recipientName,
    purchaserName: input.purchaserName,
    ...(input.message ? { message: input.message } : {}),
    paidAtIso: input.paidAtIso,
    siteUrl,
    recipient: 'recipient',
  });
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `gift-scheduled-${input.code}`,
      },
      body: JSON.stringify({
        from:
          env.RESEND_FROM_EMAIL?.trim() ||
          'Sparkling Standard <notifications@sparkling-standard.com>',
        ...(env.RESEND_REPLY_TO?.trim() ? { reply_to: env.RESEND_REPLY_TO.trim() } : {}),
        to: [input.recipientEmail],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const bucket = giftBucket(env);
  if (!bucket) return json({ ok: false, error: 'ledger_not_configured' }, 503);
  const dryRun = new URL(request.url).searchParams.get('dry') === '1';
  if (!dryRun && !env.RESEND_API_KEY?.trim()) {
    return json({ ok: false, error: 'email_not_configured' }, 503);
  }

  const today = centralToday();
  const due = await listScheduledGiftDeliveries(bucket, { dueOnOrBefore: today });
  const ready = centralMinutes() >= 540 ? due : due.filter((delivery) => delivery.deliveryDate < today);
  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      dueDate: today,
      centralTime: `${String(Math.floor(centralMinutes() / 60)).padStart(2, '0')}:${String(
        centralMinutes() % 60,
      ).padStart(2, '0')}`,
      dueCount: due.length,
      readyCount: ready.length,
      codes: ready.map((delivery) => delivery.code),
    });
  }

  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  for (const delivery of ready) {
    const certificate = await lookupGiftCertificate(bucket, delivery.code);
    if (!certificate || certificate.status !== 'active') {
      await cancelScheduledGiftDelivery(bucket, delivery.code);
      cancelled += 1;
      continue;
    }
    const ok = await sendScheduledEmail(env, {
      code: delivery.code,
      valueUsd: delivery.valueUsd,
      recipientName: delivery.recipientName,
      recipientEmail: delivery.recipientEmail,
      purchaserName: delivery.purchaserName,
      ...(delivery.message ? { message: delivery.message } : {}),
      paidAtIso: delivery.paidAtIso,
    });
    await markScheduledGiftDelivery(bucket, delivery, ok ? 'sent' : 'failed', ok ? undefined : 'email_failed');
    if (ok) sent += 1;
    else failed += 1;
  }
  return json({ ok: failed === 0, dueCount: ready.length, nextRunAfter: '09:00 America/Chicago', sent, failed, cancelled });
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
