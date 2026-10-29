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
import { legalTerms } from '../../src/config/legal.ts';
import { customerEmailProblem, normalizeCustomerEmail } from '../../src/lib/forms/contact-email.ts';
import { centralToday, isValidCalendarDate } from '../../src/lib/gift/activation.ts';
import {
  createLedgerJson,
  ledgerKey,
  paymentHash,
  paymentLedger,
  readLedgerJson,
  writeLedgerJson,
  type PaymentStorageEnv,
} from '../../src/lib/payments/ledger.ts';

interface Env extends PaymentStorageEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PUBLIC_SITE_URL?: string;
}

const MAX_NAME = 120;
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

async function expireGiftSession(env: Env, sessionId: string): Promise<void> {
  if (!env.STRIPE_SECRET_KEY?.trim() || !sessionId) return;
  await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);
  if (!giftCertificateConfig.enabled) return json({ ok: false, error: 'not_enabled' }, 403);
  if (!env.STRIPE_SECRET_KEY?.trim() || !env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return json({ ok: false, error: 'not_configured' }, 503);
  }
  const bucket = paymentLedger(env);
  if (!bucket) return json({ ok: false, error: 'ledger_not_configured' }, 503);

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  if (payload.termsAccepted !== true || payload.termsVersion !== legalTerms.termsVersion) {
    return json({ ok: false, error: 'terms_required' }, 400);
  }

  const purchaserName = cleanText(payload.purchaserName, MAX_NAME);
  const purchaserEmail = normalizeCustomerEmail(payload.purchaserEmail);
  const recipientName = cleanText(payload.recipientName, MAX_NAME);
  const recipientEmail = normalizeCustomerEmail(payload.recipientEmail);
  const message = cleanText(payload.message, MAX_MESSAGE);
  const todayCentral = centralToday();
  const validFromDate = cleanText(payload.validFromDate, 10) || todayCentral;
  const deliveryMethod =
    payload.deliveryMethod === 'recipient_email'
      ? 'recipient_email'
      : payload.deliveryMethod === 'print' || payload.deliveryMethod === undefined
        ? 'print'
        : null;
  if (!purchaserName || !deliveryMethod) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const purchaserEmailProblem = customerEmailProblem(purchaserEmail);
  if (purchaserEmailProblem) return json({ ok: false, error: purchaserEmailProblem }, 400);
  const wantsRecipientEmail = deliveryMethod === 'recipient_email';
  if (wantsRecipientEmail) {
    const recipientProblem = customerEmailProblem(recipientEmail);
    if (recipientProblem) {
      return json(
        { ok: false, error: recipientProblem === 'email_required' ? 'recipient_email_required' : 'recipient_email_invalid' },
        400,
      );
    }
  } else if (recipientEmail && customerEmailProblem(recipientEmail)) {
    return json({ ok: false, error: 'recipient_email_invalid' }, 400);
  }
  if (!isValidCalendarDate(validFromDate) || validFromDate < todayCentral) {
    return json({ ok: false, error: 'valid_from_date_invalid' }, 400);
  }
  const amount = resolveGiftAmount(payload.denominationUsd, payload.amountUsd);
  if (amount === null) return json({ ok: false, error: 'invalid_amount' }, 400);
  const checkoutAttempt = cleanText(payload.checkoutAttempt, 120);
  if (!checkoutAttempt) return json({ ok: false, error: 'invalid_request' }, 400);
  const attempt = await paymentHash(checkoutAttempt);
  const key = ledgerKey('gift-checkouts', attempt);
  const existing = await readLedgerJson<{
    status: string;
    url?: string;
    code?: string;
    createdAt?: string;
  }>(bucket, key).catch(() => null);
  if (existing?.value.status === 'open' && existing.value.url) {
    return json({ ok: true, url: existing.value.url });
  }
  if (existing?.value.status === 'completed') {
    return json({ ok: false, error: 'already_purchased' }, 409);
  }
  if (
    existing?.value.status === 'creating' &&
    Date.now() - Date.parse(existing.value.createdAt ?? '') < 120_000
  ) {
    return json({ ok: false, error: 'checkout_in_progress' }, 409);
  }

  const claim = {
    status: 'creating',
    amount,
    purchaserEmail,
    recipientEmail,
    validFromDate,
    termsVersion: legalTerms.termsVersion,
    createdAt: new Date().toISOString(),
  };
  const created = await createLedgerJson(bucket, key, claim);
  if (!created) {
    const raced = await readLedgerJson<{ status: string; url?: string }>(bucket, key).catch(() => null);
    if (raced?.value.status === 'open' && raced.value.url) {
      return json({ ok: true, url: raced.value.url });
    }
    return json({ ok: false, error: 'checkout_in_progress' }, 409);
  }

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
  body.set('metadata[checkout_kind]', 'gift_certificate');
  body.set('metadata[checkout_attempt]', attempt);
  body.set('metadata[gift_value_usd]', String(amount));
  body.set('metadata[terms_version]', legalTerms.termsVersion);
  body.set('metadata[terms_accepted_at]', new Date().toISOString());
  body.set('metadata[recipient_name]', recipientName);
  body.set('metadata[purchaser_name]', purchaserName);
  body.set('metadata[delivery_method]', deliveryMethod);
  body.set('metadata[valid_from_date]', validFromDate);
  if (recipientEmail) body.set('metadata[recipient_email]', recipientEmail);
  if (message) body.set('metadata[gift_message]', message);


  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': 'gift-' + attempt,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!response.ok || !data.url || !data.id) {
      return json({ ok: false, error: 'provider_failed' }, 502);
    }
    const record = {
      ...claim,
      status: 'open',
      sessionId: data.id,
      url: data.url,
      updatedAt: new Date().toISOString(),
    };
    let persisted = false;
    for (let attemptCount = 0; attemptCount < 3 && !persisted; attemptCount += 1) {
      try {
        await writeLedgerJson(bucket, key, record);
        persisted = true;
      } catch {
        // Retry the durable write before exposing the payment URL.
      }
    }
    if (!persisted) {
      await expireGiftSession(env, data.id);
      return json({ ok: false, error: 'checkout_state_uncertain' }, 502);
    }
    return json({ ok: true, url: data.url });
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
