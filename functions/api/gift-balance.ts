// GET /api/gift-balance?code=SSGC-XXXX-XXXX — safe balance lookup.
// Returns only status and value; never recipient/purchaser details.
import {
  giftBucket,
  lookupGiftCertificate,
  remainingCents,
  type GiftStorageEnv,
} from '../../src/lib/gift/ledger.ts';

const hits = new Map<string, { count: number; reset: number }>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function throttled(request: Request): boolean {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 20;
}

export async function onRequestGet(context: { request: Request; env: GiftStorageEnv }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);
  const bucket = giftBucket(env);
  if (!bucket) return json({ ok: false, error: 'ledger_not_configured' }, 503);
  const code = (new URL(request.url).searchParams.get('code') ?? '').trim().toUpperCase();
  if (!/^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) {
    return json({ ok: false, error: 'invalid_code' }, 400);
  }
  const record = await lookupGiftCertificate(bucket, code);
  if (!record) return json({ ok: false, error: 'not_found' }, 404);
  return json({
    ok: true,
    code: record.code,
    status: record.status,
    valueCents: record.valueCents,
    redeemedCents: record.redeemedCents,
    remainingCents: remainingCents(record),
  });
}
