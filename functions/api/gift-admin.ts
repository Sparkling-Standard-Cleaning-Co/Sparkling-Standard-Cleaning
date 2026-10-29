// Private gift-certificate register: inventory, lookup, redemption, refund,
// void and resend. Authentication is Hayli's password session from
// /api/gift-auth; no bearer token is accepted here.
//
// GET  /api/gift-admin?list=1&page=1&pageSize=20&q=&status=
// GET  /api/gift-admin?code=SSGC-XXXX-XXXX
// GET  /api/gift-admin?summary=1
// POST /api/gift-admin  { action: "redeem" | "refund" | "void" | "resend",
//                         code, password, amountCents?, note?, reference? }

import {
  giftBucket,
  lookupGiftCertificate,
  redeemGiftCertificate,
  refundGiftCertificate,
  remainingCents,
  voidGiftCertificate,
  type GiftCertificateRecord,
  type GiftStorageEnv,
} from '../../src/lib/gift/ledger.ts';
import { buildGiftCertificateEmail } from '../../src/lib/gift/delivery.ts';
import { activationInstantFor, activationDateFor, isGiftActive } from '../../src/lib/gift/activation.ts';
import { refundStripeGiftPayment, type GiftRefundResult } from '../../src/lib/gift/stripe-refund.ts';
import { readLedgerJson } from '../../src/lib/payments/ledger.ts';
import {
  adminBucket,
  audit,
  constantTimeEqual,
  readAdmin,
  readSession,
  requestIp,
  sessionTokenFromRequest,
  verifyPassword,
  type AdminRecord,
  type AdminSession,
  type AdminStorageEnv,
} from '../../src/lib/admin/auth.ts';

type StripeRefunder = (sessionId: string, code: string) => Promise<GiftRefundResult>;

interface Env extends GiftStorageEnv, AdminStorageEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_REFUNDER?: StripeRefunder;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_SITE_URL?: string;
}

interface GiftSummary {
  issuedCount: number;
  activeCount: number;
  totalOriginalCents: number;
  totalRedeemedCents: number;
  totalOutstandingCents: number;
  totalRefundedCents: number;
  totalVoidedCents: number;
  recentRedemptions: Array<{
    code: string;
    at: string;
    amountCents: number;
    note: string;
    reference: string;
  }>;
}

interface AuthContext {
  session: AdminSession;
  admin: AdminRecord;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function currentAuth(request: Request, env: Env): Promise<AuthContext | null> {
  const bucket = adminBucket(env);
  if (!bucket) return null;
  const session = await readSession(bucket, sessionTokenFromRequest(request));
  if (!session) return null;
  const admin = await readAdmin(bucket);
  if (!admin) return null;
  return { session, admin };
}

function csrfMatches(request: Request, session: AdminSession): boolean {
  return constantTimeEqual(request.headers.get('X-CSRF-Token') ?? '', session.csrf);
}

async function stepUp(
  bucket: NonNullable<ReturnType<typeof adminBucket>>,
  request: Request,
  auth: AuthContext,
  password: string,
): Promise<boolean> {
  if (!password || password.length > 200) return false;
  if (await verifyPassword(password, auth.admin.passwordHash)) return true;
  await audit(bucket, 'gift.financial.reauth', {
    success: false,
    ip: requestIp(request),
    actor: 'hayli',
  });
  return false;
}

function publicRecord(record: GiftCertificateRecord) {
  return {
    code: record.code,
    status: record.status,
    valueCents: record.valueCents,
    redeemedCents: record.redeemedCents,
    remainingCents: remainingCents(record),
    recipientName: record.recipientName,
    recipientEmail: record.recipientEmail ?? '',
    purchaserName: record.purchaserName,
    purchaserEmail: record.purchaserEmail,
    message: record.message ?? '',
    validFromDate: activationDateFor(record),
    activatesAt: activationInstantFor(record),
    activationTimezone: 'America/Chicago',
    active: isGiftActive(record),
    issuedAt: record.issuedAt,
    stripeSessionId: record.stripeSessionId,
    stripeEventId: record.stripeEventId,
    history: record.history,
    adjustments: record.adjustments ?? [],
  };
}

function adjustmentStatus(error: string): number {
  if (error === 'not_found') return 404;
  if (error === 'conflict') return 409;
  return 400;
}

async function sendGiftEmail(
  env: Env,
  to: string,
  email: ReturnType<typeof buildGiftCertificateEmail>,
  idempotencyKey: string,
): Promise<boolean> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key || !to) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey.slice(0, 200),
      },
      body: JSON.stringify({
        from:
          env.RESEND_FROM_EMAIL?.trim() ||
          'Sparkling Standard <notifications@sparkling-standard.com>',
        ...(env.RESEND_REPLY_TO?.trim() ? { reply_to: env.RESEND_REPLY_TO.trim() } : {}),
        to: [to],
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

async function allGiftRecords(bucket: NonNullable<ReturnType<typeof giftBucket>>): Promise<GiftCertificateRecord[]> {
  if (!bucket.list) return [];
  const listed = await bucket.list({ prefix: 'gifts/certificates/' });
  const records: GiftCertificateRecord[] = [];
  for (const item of listed.objects) {
    const stored = await readLedgerJson<GiftCertificateRecord>(bucket, item.key).catch(() => null);
    if (stored?.value) records.push(stored.value);
  }
  return records;
}

async function giftSummary(bucket: NonNullable<ReturnType<typeof giftBucket>>): Promise<GiftSummary> {
  const summary: GiftSummary = {
    issuedCount: 0,
    activeCount: 0,
    totalOriginalCents: 0,
    totalRedeemedCents: 0,
    totalOutstandingCents: 0,
    totalRefundedCents: 0,
    totalVoidedCents: 0,
    recentRedemptions: [],
  };
  const records = await allGiftRecords(bucket);
  for (const record of records) {
    summary.issuedCount += 1;
    summary.totalOriginalCents += record.valueCents;
    summary.totalRedeemedCents += record.redeemedCents;
    if (record.status === 'active') {
      summary.activeCount += 1;
      summary.totalOutstandingCents += remainingCents(record);
    } else if (record.status === 'refunded') {
      summary.totalRefundedCents += record.valueCents;
    } else if (record.status === 'void') {
      summary.totalVoidedCents += record.valueCents;
    }
    for (const redemption of record.history) {
      summary.recentRedemptions.push({ code: record.code, ...redemption });
    }
  }
  summary.recentRedemptions.sort((a, b) => b.at.localeCompare(a.at));
  summary.recentRedemptions = summary.recentRedemptions.slice(0, 25);
  return summary;
}

async function giftList(
  bucket: NonNullable<ReturnType<typeof giftBucket>>,
  url: URL,
): Promise<{
  items: Array<ReturnType<typeof publicRecord> & {
    activationStatus: string;
    lastRedemptionAt: string;
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const requestedPage = Number(url.searchParams.get('page') ?? '1');
  const requestedSize = Number(url.searchParams.get('pageSize') ?? '20');
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const pageSize = Number.isSafeInteger(requestedSize) ? Math.min(50, Math.max(5, requestedSize)) : 20;
  const status = (url.searchParams.get('status') ?? '').trim().toLowerCase();
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 100);
  const records = (await allGiftRecords(bucket)).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const filtered = records.filter((record) => {
    if (status && record.status !== status) return false;
    if (!query) return true;
    return [record.code, record.purchaserName, record.purchaserEmail, record.recipientName, record.recipientEmail ?? '']
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRecords = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const items = [];
  for (const record of pageRecords) {
    items.push({
      ...publicRecord(record),
      activationStatus: isGiftActive(record) ? 'active' : 'not_yet_active',
      lastRedemptionAt: record.history.at(-1)?.at ?? '',
    });
  }
  return { items, page: safePage, pageSize, total: filtered.length, totalPages };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const auth = await currentAuth(request, env);
  if (!auth) return json({ ok: false, error: 'unauthorized' }, 401);
  const bucket = giftBucket(env);
  if (!bucket) return json({ ok: false, error: 'ledger_not_configured' }, 503);
  const url = new URL(request.url);
  if (url.searchParams.get('list') === '1') {
    return json({ ok: true, ...(await giftList(bucket, url)) });
  }
  if (url.searchParams.get('summary') === '1') {
    return json({ ok: true, summary: await giftSummary(bucket) });
  }
  const code = url.searchParams.get('code')?.trim() ?? '';
  if (!/^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code.toUpperCase())) {
    return json({ ok: false, error: 'invalid_code' }, 400);
  }
  const record = await lookupGiftCertificate(bucket, code);
  if (!record) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, certificate: publicRecord(record) });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const auth = await currentAuth(request, env);
  if (!auth) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!csrfMatches(request, auth.session)) return json({ ok: false, error: 'csrf_failed' }, 403);
  const bucket = giftBucket(env);
  if (!bucket) return json({ ok: false, error: 'ledger_not_configured' }, 503);
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
  const amountCents = Number(payload.amountCents);
  const note = typeof payload.note === 'string' ? payload.note : '';
  const reference = typeof payload.reference === 'string' ? payload.reference : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const action =
    payload.action === 'redeem' ||
    payload.action === 'refund' ||
    payload.action === 'void' ||
    payload.action === 'resend'
      ? payload.action
      : null;
  if (!action) return json({ ok: false, error: 'invalid_action' }, 400);
  if (!/^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
    return json({ ok: false, error: 'invalid_code' }, 400);
  }
  if (action !== 'resend' && !(await stepUp(bucket, request, auth, password))) {
    return json({ ok: false, error: 'reauth_failed' }, 401);
  }

  if (action === 'redeem') {
    const result = await redeemGiftCertificate(bucket, code, amountCents, note, reference);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, adjustmentStatus(result.error));
    }
    await audit(bucket, 'gift.redeem', {
      success: true,
      ip: requestIp(request),
      actor: 'hayli',
      detail: `${code}:${amountCents}`,
    });
    return json({
      ok: true,
      redeemedCents: result.redeemedCents,
      certificate: publicRecord(result.record),
    });
  }

  if (action === 'void') {
    const result = await voidGiftCertificate(bucket, code, note, reference);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, adjustmentStatus(result.error));
    }
    await audit(bucket, 'gift.void', {
      success: true,
      ip: requestIp(request),
      actor: 'hayli',
      detail: code,
    });
    return json({
      ok: true,
      already: result.already,
      certificate: publicRecord(result.record),
    });
  }

  const existing = await lookupGiftCertificate(bucket, code);
  if (!existing) return json({ ok: false, error: 'not_found' }, 404);

  if (action === 'resend') {
    if (existing.status !== 'active') return json({ ok: false, error: 'inactive' }, 400);
    const recipient = existing.recipientEmail || existing.purchaserEmail;
    if (!recipient) return json({ ok: false, error: 'recipient_email_required' }, 400);
    const siteUrl = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
    const email = buildGiftCertificateEmail({
      code: existing.code,
      valueUsd: existing.valueCents / 100,
      recipientName: existing.recipientName,
      purchaserName: existing.purchaserName,
      ...(existing.message ? { message: existing.message } : {}),
      validFromDate: activationDateFor(existing),
      paidAtIso: existing.issuedAt,
      siteUrl,
      recipient: existing.recipientEmail ? 'recipient' : 'purchaser',
    });
    const sent = await sendGiftEmail(env, recipient, email, `gift-manual-${code}-${Date.now()}`);
    await audit(bucket, 'gift.resend', {
      success: sent,
      ip: requestIp(request),
      actor: 'hayli',
      detail: code,
    });
    return json({ ok: sent, sent, to: recipient }, sent ? 200 : 502);
  }
  if (existing.status === 'refunded') {
    return json({
      ok: true,
      already: true,
      certificate: publicRecord(existing),
    });
  }
  if (existing.status !== 'active') return json({ ok: false, error: 'inactive' }, 400);
  if (existing.redeemedCents > 0) return json({ ok: false, error: 'redeemed' }, 400);
  if ((existing.reservations ?? []).some((entry) => entry.status === 'reserved' && Date.parse(entry.expiresAt) > Date.now())) {
    return json({ ok: false, error: 'reserved' }, 409);
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? '';
  const refunder: StripeRefunder | null =
    env.STRIPE_REFUNDER ??
    (secretKey
      ? (sessionId, giftCode) => refundStripeGiftPayment({ secretKey, sessionId, code: giftCode })
      : null);
  if (!refunder) return json({ ok: false, error: 'stripe_not_configured' }, 503);
  let refund: GiftRefundResult;
  try {
    refund = await refunder(existing.stripeSessionId, code);
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
  if (!refund.ok) return json({ ok: false, error: refund.error }, 502);

  const result = await refundGiftCertificate(
    bucket,
    code,
    note,
    reference,
    refund.refundId,
  );
  if (!result.ok) {
    // Stripe has refunded the payment. A retry is safe because the refund uses
    // a fixed idempotency key; the owner must not treat this as complete yet.
    return json({ ok: false, error: 'ledger_update_failed' }, 500);
  }
  await audit(bucket, 'gift.refund', {
    success: true,
    ip: requestIp(request),
    actor: 'hayli',
    detail: `${code}:${refund.refundId}`,
  });
  return json({
    ok: true,
    already: result.already,
    refundId: refund.refundId,
    certificate: publicRecord(result.record),
  });
}
