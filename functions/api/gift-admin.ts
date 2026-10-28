// Owner-only gift-certificate lookup and redemption. Protected by a server
// secret in the Authorization header; never linked publicly or exposed to the
// browser bundle.
//
// GET  /api/gift-admin?code=SSGC-XXXX-XXXX
// POST /api/gift-admin  { code, amountCents, note, reference }

import {
  giftBucket,
  lookupGiftCertificate,
  redeemGiftCertificate,
  remainingCents,
  type GiftStorageEnv,
} from '../../src/lib/gift/ledger.ts';

interface Env extends GiftStorageEnv {
  GIFT_OWNER_TOKEN?: string;
  PHOTO_OWNER_TOKEN?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.GIFT_OWNER_TOKEN?.trim() || env.PHOTO_OWNER_TOKEN?.trim() || '';
  if (!expected) return false;
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return Boolean(match && constantTimeEqual(match[1]!.trim(), expected));
}

function publicRecord(record: NonNullable<Awaited<ReturnType<typeof lookupGiftCertificate>>>) {
  return {
    code: record.code,
    status: record.status,
    valueCents: record.valueCents,
    redeemedCents: record.redeemedCents,
    remainingCents: remainingCents(record),
    recipientName: record.recipientName,
    purchaserName: record.purchaserName,
    purchaserEmail: record.purchaserEmail,
    issuedAt: record.issuedAt,
    history: record.history,
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const bucket = giftBucket(env);
  if (!bucket) return json({ ok: false, error: 'ledger_not_configured' }, 503);
  const code = new URL(request.url).searchParams.get('code')?.trim() ?? '';
  if (!/^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code.toUpperCase())) {
    return json({ ok: false, error: 'invalid_code' }, 400);
  }
  const record = await lookupGiftCertificate(bucket, code);
  if (!record) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, certificate: publicRecord(record) });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
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
  if (!/^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
    return json({ ok: false, error: 'invalid_code' }, 400);
  }
  const result = await redeemGiftCertificate(bucket, code, amountCents, note, reference);
  if (!result.ok) {
    return json(
      { ok: false, error: result.error },
      result.error === 'not_found' ? 404 : result.error === 'conflict' ? 409 : 400,
    );
  }
  return json({
    ok: true,
    redeemedCents: result.redeemedCents,
    certificate: publicRecord(result.record),
  });
}
