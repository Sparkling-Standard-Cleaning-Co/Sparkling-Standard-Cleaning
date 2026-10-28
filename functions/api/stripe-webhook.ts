// POST /api/stripe-webhook — authoritative payment confirmation for estimate
// payments and gift certificates.
//
// Reliability:
//  - Stripe signature is verified before any state change.
//  - A paid event is claimed in the durable R2 ledger before fulfillment.
//    Cloudflare isolates can run in parallel; process memory is never the only
//    record of a payment.
//  - Duplicate event deliveries return success without sending/fulfilling
//    twice. If a notification provider fails, the paid record remains in the
//    ledger and Stripe's retry can safely resume the notification.
//  - Cleaning payments never issue gift certificates and gift payments never
//    create cleaning reservations.
//
// Responses: 200 | 400 | 405 | 500 | 503

import { verifyStripeSignature } from '../../src/lib/gift/stripe-signature.ts';
import { buildGiftFulfillment, giftCertificateCodeFor } from '../../src/lib/gift/fulfillment.ts';
import { giftBucket, issueGiftCertificate, remainingCents } from '../../src/lib/gift/ledger.ts';
import { buildGiftCertificateEmail } from '../../src/lib/gift/delivery.ts';
import { createScheduledGiftDelivery, type ScheduledGiftDelivery } from '../../src/lib/gift/scheduled-delivery.ts';
import {
  completePaymentEvent,
  failPaymentEvent,
  incompletePaymentEvent,
  claimPaymentEvent,
  type PaymentEventRecord,
} from '../../src/lib/payments/event-ledger.ts';
import {
  ledgerKey,
  paymentLedger,
  readLedgerJson,
  writeLedgerJson,
  type PaymentStorageEnv,
} from '../../src/lib/payments/ledger.ts';

interface Env extends PaymentStorageEnv {
  STRIPE_WEBHOOK_SECRET?: string;
  WEB3FORMS_ACCESS_KEY?: string;
  WEB3FORMS_ENDPOINT?: string;
  PUBLIC_SITE_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

interface StripeEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: {
    object?: {
      id?: string;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      customer_details?: { email?: string; name?: string };
      metadata?: Record<string, string>;
    };
  };
}

interface CheckoutLedgerRecord {
  version?: number;
  status?: string;
  generation?: number;
  createdAt?: string;
  updatedAt?: string;
  reference?: string;
  amountCents?: number;
  serviceType?: string;
  sessionId?: string;
  sessionUrl?: string;
}

const processedEvents = new Set<string>();
const MAX_TRACKED_EVENTS = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function amountCentsFrom(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function markInMemory(eventId: string): void {
  processedEvents.add(eventId);
  if (processedEvents.size > MAX_TRACKED_EVENTS) {
    const oldest = processedEvents.values().next().value;
    if (oldest) processedEvents.delete(oldest);
  }
}

async function updateCheckoutRecord(
  env: Env,
  attempt: string,
  session: NonNullable<StripeEvent['data']>['object'],
): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(attempt)) return;
  const bucket = paymentLedger(env);
  if (!bucket) return;
  const key = ledgerKey('checkouts', attempt.toLowerCase());
  try {
    const existing = await readLedgerJson<CheckoutLedgerRecord>(bucket, key);
    const now = new Date().toISOString();
    const record: CheckoutLedgerRecord = {
      ...(existing?.value ?? {}),
      version: 1,
      status: 'completed',
      generation: existing?.value.generation ?? 0,
      createdAt: existing?.value.createdAt ?? now,
      updatedAt: now,
      reference: existing?.value.reference ?? session?.metadata?.quote_reference ?? '',
      amountCents:
        amountCentsFrom(session?.amount_total) ?? existing?.value.amountCents ?? 0,
      serviceType:
        existing?.value.serviceType ?? session?.metadata?.service_type ?? 'cleaning',
      ...(session?.id ? { sessionId: session.id } : {}),
    };
    await writeLedgerJson(bucket, key, record);
  } catch (error) {
    console.error('[stripe-webhook] checkout_record_update_failed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
  }
}

async function notifyOwner(
  env: Env,
  subject: string,
  fields: Record<string, string>,
): Promise<boolean> {
  if (!env.WEB3FORMS_ACCESS_KEY) return false;
  try {
    const response = await fetch(env.WEB3FORMS_ENDPOINT ?? 'https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: env.WEB3FORMS_ACCESS_KEY,
        subject,
        from_name: 'Sparkling Standard Website',
        botcheck: '',
        ...fields,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean };
    return response.ok && data.success === true;
  } catch {
    return false;
  }
}

async function sendCustomerGiftEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  text: string,
  idempotencyKey: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY?.trim()) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || 'Sparkling Standard <notifications@sparkling-standard.com>',
        to: [to],
        subject,
        html,
        text,
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

  // Only a completed, actually-paid Checkout Session authorizes anything.
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
  const amountCents = amountCentsFrom(session.amount_total);
  const giftValueUsd = (() => {
    const value = Number(metadata.gift_value_usd);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  })();
  const kind = metadata.checkout_kind === 'estimate_payment' ? 'estimate' : 'gift';
  const reference = (metadata.quote_reference ?? '').trim();
  const customerName = (session.customer_details?.name ?? '').trim();
  const customerEmail = (session.customer_details?.email ?? '').trim();
  const paidAt = event.created
    ? new Date(event.created * 1000).toISOString()
    : new Date().toISOString();

  const seed: Omit<
    PaymentEventRecord,
    'version' | 'status' | 'attempts' | 'firstSeenAt' | 'updatedAt'
  > = {
    eventId,
    kind,
    sessionId: session.id ?? '',
    amountCents,
    reference,
    serviceType: metadata.service_type ?? (kind === 'gift' ? 'gift_certificate' : 'cleaning'),
    ...(customerName ? { customerName } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(kind === 'gift'
      ? {
          gift: {
            valueUsd: giftValueUsd,
            recipientName: (metadata.recipient_name ?? '').trim(),
            purchaserName: (metadata.purchaser_name ?? '').trim(),
            purchaserEmail: customerEmail,
            ...(metadata.recipient_email ? { recipientEmail: metadata.recipient_email } : {}),
            ...(metadata.gift_message ? { message: metadata.gift_message } : {}),
            ...(metadata.delivery_date ? { deliveryDate: metadata.delivery_date } : {}),
            ...(metadata.delivery_method === 'recipient_email' || metadata.delivery_method === 'print'
              ? { deliveryMethod: metadata.delivery_method }
              : metadata.recipient_email
                ? { deliveryMethod: 'recipient_email' as const }
                : { deliveryMethod: 'print' as const }),
            ...(metadata.delivery_timing === 'scheduled' || metadata.delivery_timing === 'immediate'
              ? { deliveryTiming: metadata.delivery_timing }
              : { deliveryTiming: 'immediate' as const }),
          },
        }
      : {}),
  };

  const bucket = paymentLedger(env);
  let record: PaymentEventRecord | null = null;
  if (bucket) {
    try {
      const claim = await claimPaymentEvent(bucket, eventId, seed);
      if (claim.action === 'duplicate') {
        markInMemory(eventId);
        return json({ ok: true, received: true, duplicate: true });
      }
      if (claim.action === 'busy') {
        return json({ ok: false, error: 'event_in_progress' }, 503);
      }
      record = claim.record;
    } catch (error) {
      console.error('[stripe-webhook] ledger_claim_failed', {
        name: error instanceof Error ? error.name : 'unknown',
      });
      // Do not lose a paid event because durable storage is temporarily
      // unavailable. The readiness gate prevents new payments in this state;
      // existing payments still reach the owner.
    }
  } else {
    console.error('[stripe-webhook] durable_ledger_not_configured');
  }

  if (kind === 'estimate') {
    if (session.id && metadata.checkout_attempt) {
      await updateCheckoutRecord(env, metadata.checkout_attempt, session);
    }

    const amount = amountCents === null ? 'unknown' : (amountCents / 100).toFixed(2);
    const fields: Record<string, string> = {
      'Payment status': 'PAID - verify in Stripe before scheduling',
      'Amount paid': `$${amount} USD`,
      'Quote reference': reference || 'reference unavailable',
      Service: metadata.service_type ?? 'cleaning',
      Customer: customerName || 'name not supplied by Stripe',
      Email: customerEmail || 'email not supplied by Stripe',
      'Stripe event': eventId,
      'Stripe session': session.id ?? '',
      'Checkout attempt': metadata.checkout_attempt ?? '',
      'Paid at': paidAt,
      Note:
        'The cleaning request was delivered separately by the website lead relay. Confirm the requested date, scope and final details personally before scheduling.',
    };
    const sent = await notifyOwner(
      env,
      `PAID estimate - $${amount} - ${reference || 'reference unavailable'}`,
      fields,
    );
    if (!sent) {
      if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'notification_failed');
      return json({ ok: false, error: 'notification_failed' }, 500);
    }
    markInMemory(eventId);
    if (bucket && record) {
      await completePaymentEvent(bucket, eventId, record).catch((error) => {
        console.error('[stripe-webhook] event_complete_failed', {
          name: error instanceof Error ? error.name : 'unknown',
        });
      });
    }
    return json({ ok: true, received: true });
  }

  // Gift certificate path (sales remain disabled until owner approval).
  if (!seed.gift || !seed.gift.valueUsd || !seed.gift.recipientName || !seed.gift.purchaserName || !seed.gift.purchaserEmail) {
    if (bucket && record) {
      await incompletePaymentEvent(bucket, eventId, record, 'missing_gift_metadata').catch(() => undefined);
    }
    return json({ ok: true, received: true, incomplete: true });
  }

  const giftLedger = giftBucket(env);
  if (!giftLedger) {
    if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'gift_ledger_not_configured');
    return json({ ok: false, error: 'gift_ledger_not_configured' }, 503);
  }
  const code = giftCertificateCodeFor({ eventId });
  let issued;
  try {
    issued = await issueGiftCertificate(giftLedger, {
      version: 1,
      code,
      status: 'active',
      valueCents: Math.round(seed.gift.valueUsd * 100),
      redeemedCents: 0,
      recipientName: seed.gift.recipientName,
      purchaserName: seed.gift.purchaserName,
      purchaserEmail: seed.gift.purchaserEmail,
      ...(seed.gift.recipientEmail ? { recipientEmail: seed.gift.recipientEmail } : {}),
      ...(seed.gift.message ? { message: seed.gift.message } : {}),
      ...(seed.gift.deliveryDate ? { deliveryDate: seed.gift.deliveryDate } : {}),
      stripeEventId: eventId,
      stripeSessionId: session.id ?? '',
      issuedAt: paidAt,
      history: [],
    });
  } catch {
    if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'gift_issue_failed');
    return json({ ok: false, error: 'gift_issue_failed' }, 500);
  }
  const todayCentral = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
  }).format(new Date());
  const scheduled =
    seed.gift.deliveryTiming === 'scheduled' &&
    Boolean(seed.gift.recipientEmail) &&
    Boolean(seed.gift.deliveryDate) &&
    (seed.gift.deliveryDate ?? '') > todayCentral;
  let scheduledRecord: ScheduledGiftDelivery | null = null;
  if (scheduled) {
    try {
      const created = await createScheduledGiftDelivery(giftLedger, {
        version: 1,
        code,
        valueUsd: seed.gift.valueUsd,
        recipientName: seed.gift.recipientName,
        recipientEmail: seed.gift.recipientEmail!,
        purchaserName: seed.gift.purchaserName,
        purchaserEmail: seed.gift.purchaserEmail,
        ...(seed.gift.message ? { message: seed.gift.message } : {}),
        deliveryDate: seed.gift.deliveryDate!,
        deliveryMethod: 'recipient_email',
        deliveryTiming: 'scheduled',
        paidAtIso: paidAt,
        stripeEventId: eventId,
        stripeSessionId: session.id ?? '',
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      scheduledRecord = created.delivery;
    } catch {
      if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'gift_schedule_failed');
      return json({ ok: false, error: 'gift_schedule_failed' }, 500);
    }
  }

  const fulfillment = buildGiftFulfillment({
    eventId,
    sessionId: session.id ?? '',
    valueUsd: seed.gift.valueUsd,
    recipientName: seed.gift.recipientName,
    purchaserName: seed.gift.purchaserName,
    purchaserEmail: seed.gift.purchaserEmail,
    ...(seed.gift.recipientEmail ? { recipientEmail: seed.gift.recipientEmail } : {}),
    ...(seed.gift.message ? { message: seed.gift.message } : {}),
    ...(seed.gift.deliveryDate ? { deliveryDate: seed.gift.deliveryDate } : {}),
    ...(seed.gift.deliveryMethod ? { deliveryMethod: seed.gift.deliveryMethod } : {}),
    ...(seed.gift.deliveryTiming ? { deliveryTiming: seed.gift.deliveryTiming } : {}),
    paidAtIso: paidAt,
    ...(env.PUBLIC_SITE_URL ? { siteUrl: env.PUBLIC_SITE_URL } : {}),
  });
  fulfillment['Ledger status'] = issued.created ? 'Created once' : 'Existing record reused';
  fulfillment['Remaining value'] = `$${(remainingCents(issued.record) / 100).toFixed(2)}`;
  const siteUrl = env.PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://sparkling-standard.com';
  const email = buildGiftCertificateEmail({
    code,
    valueUsd: seed.gift.valueUsd,
    recipientName: seed.gift.recipientName,
    purchaserName: seed.gift.purchaserName,
    ...(seed.gift.message ? { message: seed.gift.message } : {}),
    paidAtIso: paidAt,
    siteUrl,
    recipient: 'purchaser',
  });
  const purchaserDelivered = await sendCustomerGiftEmail(
    env,
    seed.gift.purchaserEmail,
    email.subject,
    email.html,
    email.text,
    `gift-${eventId}-purchaser`,
  );
  let recipientDelivered = true;
  if (scheduledRecord) {
    fulfillment['Scheduled recipient delivery'] = `Pending for ${scheduledRecord.deliveryDate} (owner delivery processor)`;
  } else if (
    seed.gift.deliveryMethod === 'recipient_email' &&
    seed.gift.recipientEmail
  ) {
    const recipientEmail = buildGiftCertificateEmail({
      code,
      valueUsd: seed.gift.valueUsd,
      recipientName: seed.gift.recipientName,
      purchaserName: seed.gift.purchaserName,
      ...(seed.gift.message ? { message: seed.gift.message } : {}),
      paidAtIso: paidAt,
      siteUrl,
      recipient: 'recipient',
    });
    recipientDelivered = await sendCustomerGiftEmail(
      env,
      seed.gift.recipientEmail,
      recipientEmail.subject,
      recipientEmail.html,
      recipientEmail.text,
      `gift-${eventId}-recipient`,
    );
  }
  fulfillment['Customer delivery'] =
    purchaserDelivered && recipientDelivered
      ? scheduledRecord
        ? 'Purchaser confirmed; recipient delivery scheduled'
        : 'Sent to purchaser' +
          (seed.gift.deliveryMethod === 'recipient_email' && seed.gift.recipientEmail ? ' and recipient' : '')
      : 'FAILED - retry via Stripe or deliver manually';
  if (!purchaserDelivered || !recipientDelivered) {
    if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'customer_delivery_failed');
    return json({ ok: false, error: 'customer_delivery_failed' }, 500);
  }

  const sent = await notifyOwner(
    env,
    `PAID gift certificate - ${fulfillment['Gift value']} - ${seed.gift.recipientName}`,
    fulfillment,
  );
  if (!sent) {
    if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'notification_failed');
    return json({ ok: false, error: 'notification_failed' }, 500);
  }
  markInMemory(eventId);
  if (bucket && record) {
    await completePaymentEvent(bucket, eventId, record).catch((error) => {
      console.error('[stripe-webhook] event_complete_failed', {
        name: error instanceof Error ? error.name : 'unknown',
      });
    });
  }
  return json({ ok: true, received: true });
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
