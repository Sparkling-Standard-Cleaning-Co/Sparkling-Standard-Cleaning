// POST /api/gift-checkout — creates a Stripe-hosted Checkout Session for a
// gift certificate. DORMANT until the owner activates gift certificates and
// configures Stripe: no card data ever touches this site or function.
//
// Security:
//  - Amounts are resolved SERVER-SIDE from the approved configuration; a
//    client-supplied amount is never trusted unless it passes the configured
//    custom-amount bounds.
//  - Only Stripe-hosted Checkout is used (no custom card collection).
//  - The success URL is display only; issuance is authorized solely by the
//    verified webhook in functions/api/stripe-webhook.ts.
//
// Responses: 200 { ok, url } | 400 | 403 not_enabled | 405 | 429 | 502 | 503

import { giftCertificateConfig } from '../../src/config/gift-certificates.ts';

interface Env {
  STRIPE_SECRET_KEY?: string;
  PUBLIC_SITE_URL?: string;
}

const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_MESSAGE = giftCertificateConfig.maxMessageLength;
const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = 10;
const hits = new Map<string, { count: number; reset: number }>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function throttled(request: Request): boolean {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > PER_IP_PER_MINUTE;
}

/** Resolves the certificate value from approved config; null = rejected. */
export function resolveGiftAmount(
  denominationUsd: unknown,
  amountUsd: unknown,
): number | null {
  const denomination = typeof denominationUsd === 'number' ? denominationUsd : Number(denominationUsd);
  if (Number.isFinite(denomination) && giftCertificateConfig.denominations.includes(denomination)) {
    return denomination;
  }
  if (giftCertificateConfig.allowCustomAmount) {
    const amount = typeof amountUsd === 'number' ? amountUsd : Number(amountUsd);
    if (
      Number.isFinite(amount) &&
      amount >= giftCertificateConfig.customAmountMinUsd &&
      amount <= giftCertificateConfig.customAmountMaxUsd
    ) {
      return Math.round(amount * 100) / 100;
    }
  }
  return null;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);
  if (!giftCertificateConfig.enabled) return json({ ok: false, error: 'not_enabled' }, 403);
  if (!env.STRIPE_SECRET_KEY?.trim()) return json({ ok: false, error: 'not_configured' }, 503);

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const purchaserName = cleanText(payload.purchaserName, MAX_NAME);
  const purchaserEmail = cleanText(payload.purchaserEmail, MAX_EMAIL);
  const recipientName = cleanText(payload.recipientName, MAX_NAME);
  const recipientEmail = cleanText(payload.recipientEmail, MAX_EMAIL);
  const message = cleanText(payload.message, MAX_MESSAGE);
  const deliveryDate = cleanText(payload.deliveryDate, 10);

  if (!purchaserName || !recipientName || !isEmail(purchaserEmail)) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  if (recipientEmail && !isEmail(recipientEmail)) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const amount = resolveGiftAmount(payload.denominationUsd, payload.amountUsd);
  if (amount === null) return json({ ok: false, error: 'invalid_amount' }, 400);

  const site = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${site}/gift-certificates/success/?session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${site}/gift-certificates/?canceled=1`);
  body.set('customer_email', purchaserEmail);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)));
  body.set('line_items[0][price_data][product_data][name]', `Sparkling Standard Gift Certificate — $${amount}`);
  body.set(
    'line_items[0][price_data][product_data][description]',
    'Gift certificate value toward Sparkling Standard cleaning services. Redeemed by code with the owner.',
  );
  body.set('metadata[gift_value_usd]', String(amount));
  body.set('metadata[recipient_name]', recipientName);
  body.set('metadata[purchaser_name]', purchaserName);
  if (recipientEmail) body.set('metadata[recipient_email]', recipientEmail);
  if (message) body.set('metadata[gift_message]', message);
  if (deliveryDate) body.set('metadata[delivery_date]', deliveryDate);

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
    if (!response.ok || !data.url) {
      return json({ ok: false, error: 'provider_failed' }, 502);
    }
    return json({ ok: true, url: data.url });
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
