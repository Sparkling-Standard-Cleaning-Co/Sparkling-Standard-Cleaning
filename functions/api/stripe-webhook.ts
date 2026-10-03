// POST /api/stripe-webhook — authoritative payment confirmation for gift
// certificates. Issuance is authorized ONLY by a signature-verified,
// paid Checkout Session event (never by a visitor reaching a success URL).
//
// Idempotency: the certificate code is derived from the Stripe event id, and
// processed event ids are remembered in-isolate. A retried event therefore
// never mints a second code; the owner ledger records the Stripe event id as
// the durable dedupe key. If the notification cannot be forwarded, a 500 is
// returned so Stripe retries rather than losing a paid purchase.
//
// Responses: 200 { received } | 400 invalid_signature | 405 | 500 | 503

import { verifyStripeSignature } from '../../src/lib/gift/stripe-signature.ts';
import { buildGiftFulfillment } from '../../src/lib/gift/fulfillment.ts';

interface Env {
  STRIPE_WEBHOOK_SECRET?: string;
  WEB3FORMS_ACCESS_KEY?: string;
  WEB3FORMS_ENDPOINT?: string;
  PUBLIC_SITE_URL?: string;
}

interface StripeEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: {
    object?: {
      id?: string;
      payment_status?: string;
      customer_details?: { email?: string; name?: string };
      metadata?: Record<string, string>;
    };
  };
}

const processedEvents = new Set<string>();
const MAX_TRACKED_EVENTS = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function numberFrom(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return json({ ok: false, error: 'not_configured' }, 503);

  const payload = await request.text();
  const verified = await verifyStripeSignature(payload, request.headers.get('stripe-signature'), secret);
  if (!verified.ok) return json({ ok: false, error: 'invalid_signature', reason: verified.reason }, 400);

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  // Only a completed, actually-paid Checkout Session authorizes issuance.
  if (event.type !== 'checkout.session.completed' || event.data?.object?.payment_status !== 'paid') {
    return json({ ok: true, received: true, ignored: true });
  }
  const session = event.data.object ?? {};
  const eventId = event.id ?? '';
  if (!eventId) return json({ ok: false, error: 'invalid_request' }, 400);
  if (processedEvents.has(eventId)) {
    return json({ ok: true, received: true, duplicate: true });
  }

  const metadata = session.metadata ?? {};
  const valueUsd = numberFrom(metadata.gift_value_usd);
  const recipientName = (metadata.recipient_name ?? '').trim();
  const purchaserName = (metadata.purchaser_name ?? '').trim();
  const purchaserEmail = (session.customer_details?.email ?? '').trim();
  if (!valueUsd || !recipientName || !purchaserName || !purchaserEmail) {
    // Missing data must not authorize a certificate; 200 stops Stripe retries
    // and the owner receives nothing — the ledger will show a paid session
    // without a fulfillment, which is visibly wrong and auditable.
    return json({ ok: true, received: true, incomplete: true });
  }

  const fulfillment = buildGiftFulfillment({
    eventId,
    sessionId: session.id ?? '',
    valueUsd,
    recipientName,
    purchaserName,
    purchaserEmail,
    ...(metadata.recipient_email ? { recipientEmail: metadata.recipient_email } : {}),
    ...(metadata.gift_message ? { message: metadata.gift_message } : {}),
    ...(metadata.delivery_date ? { deliveryDate: metadata.delivery_date } : {}),
    paidAtIso: event.created ? new Date(event.created * 1000).toISOString() : new Date().toISOString(),
    ...(env.PUBLIC_SITE_URL ? { siteUrl: env.PUBLIC_SITE_URL } : {}),
  });

  if (!env.WEB3FORMS_ACCESS_KEY) {
    // Paid purchase with no way to alert the owner: let Stripe retry.
    return json({ ok: false, error: 'not_configured' }, 500);
  }
  try {
    const response = await fetch(env.WEB3FORMS_ENDPOINT ?? 'https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: env.WEB3FORMS_ACCESS_KEY,
        subject: `PAID gift certificate — ${fulfillment['Gift value']} — ${recipientName}`,
        from_name: 'Sparkling Standard Website',
        botcheck: '',
        ...fulfillment,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean };
    if (!response.ok || data.success !== true) {
      return json({ ok: false, error: 'provider_failed' }, 500);
    }
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 500);
  }

  processedEvents.add(eventId);
  if (processedEvents.size > MAX_TRACKED_EVENTS) {
    const oldest = processedEvents.values().next().value;
    if (oldest) processedEvents.delete(oldest);
  }
  return json({ ok: true, received: true });
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
