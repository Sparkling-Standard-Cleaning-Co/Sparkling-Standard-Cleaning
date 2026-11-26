// POST /api/address-review - customer-requested review of a residential
// address that was classified (or suspected) as commercial. Requests create
// a private administrative review record; they do not change the address or
// create a booking.
import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { audit } from '../../src/lib/admin/operations.ts';
import { checkPublicRateLimit, clientIp, consumePublicRateLimit, PUBLIC_RATE_LIMITS } from '../../src/lib/public-rate-limit.ts';

interface Env extends AdminDbEnv {
  TURNSTILE_SECRET_KEY?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function reference(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `ADR-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!sameOrigin(context.request)) return json({ ok: false, error: 'origin_rejected' }, 403);
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  const ip = clientIp(context.request);
  const limit = await checkPublicRateLimit(db, 'address-review', ip, PUBLIC_RATE_LIMITS.careerIp);
  if (limit.limited) return json({ ok: false, error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  await consumePublicRateLimit(db, 'address-review', ip, PUBLIC_RATE_LIMITS.careerIp);

  let body: Record<string, unknown>;
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const addressText = text(body.addressText, 300);
  const city = text(body.city, 80);
  const state = text(body.state, 2).toUpperCase();
  const zip = text(body.zip, 10);
  const businessName = text(body.businessName, 160);
  const customerName = text(body.customerName, 120);
  const customerEmail = text(body.customerEmail, 200).toLowerCase();
  const customerPhone = text(body.customerPhone, 40);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (addressText.length < 5) return json({ ok: false, error: 'address_required' }, 400);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ ok: false, error: 'location_invalid' }, 400);
  }
  if (state && state !== 'FL' && state !== 'AL') return json({ ok: false, error: 'state_invalid' }, 400);
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail)) {
    return json({ ok: false, error: 'email_invalid' }, 400);
  }

  const id = `addrrev_${crypto.randomUUID()}`;
  const appReference = reference();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO address_review_requests
       (id, reference, status, address_text, city, state, zip, latitude, longitude,
        detected_business_name, classification, customer_name, customer_email, customer_phone,
        created_at, updated_at)
       VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, 'commercial', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      appReference,
      addressText,
      city,
      state,
      zip,
      lat,
      lng,
      businessName,
      customerName,
      customerEmail,
      customerPhone,
      now,
      now,
    )
    .run();
  await audit(db, {
    actorUserId: null,
    action: 'address_review.requested',
    entityType: 'address_review_request',
    entityId: id,
    detail: appReference,
  }).catch(() => undefined);
  // The owner sees the request in the admin review queue. No customer message
  // is sent automatically; the request itself is the acknowledgment.
  return json({ ok: true, reference: appReference, status: 'new' }, 201);
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}

