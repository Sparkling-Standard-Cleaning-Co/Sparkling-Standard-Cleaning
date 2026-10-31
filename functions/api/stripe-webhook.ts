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
import { commitGiftReservation, giftBucket, issueGiftCertificate, releaseGiftReservation, remainingCents } from '../../src/lib/gift/ledger.ts';
import { buildGiftCertificateEmail } from '../../src/lib/gift/delivery.ts';
import { activationInstant, centralToday, isValidCalendarDate } from '../../src/lib/gift/activation.ts';
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
import { sendCustomerReceipt, describeReceiptOutcome } from '../../src/lib/forms/customer-receipt.ts';
import { autoConfirmPaidBooking } from '../../src/lib/booking/auto-confirm.ts';
import type { BookingEnv } from '../../src/lib/booking/service.ts';
import type { D1Database } from '../../src/lib/admin/d1.ts';
import { applyInvoiceCheckoutPayment } from '../../src/lib/admin/stripe-reconcile.ts';
import { recordSavedCardSetup } from '../../src/lib/admin/stripe-billing.ts';
import type { ReceiptData, ReceiptLine } from '../../src/lib/payments/receipt.ts';

interface Env extends PaymentStorageEnv, BookingEnv {
  DB?: D1Database;
  STRIPE_SECRET_KEY?: string;
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
      customer?: string;
      payment_intent?: string;
      mode?: string;
      setup_intent?: string;
    };
  };
}

interface CheckoutReceiptSnapshot {
  service: string;
  serviceLocation: string;
  customerName?: string;
  customerEmail: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  taxCents: number;
  taxRatePercent: number | null;
  taxJurisdiction: string | null;
  totalCents: number;
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
  receipt?: CheckoutReceiptSnapshot;
  gift?: {
    code: string;
    reservationId: string;
    appliedCents: number;
    totalCents: number;
    paidByGift: boolean;
  };
  chargeAmountCents?: number;
  photosOutstanding?: boolean;
  bookingStatus?: 'confirmed' | 'pending_owner_review';
  bookingEventId?: string;
}

async function readCheckoutRecord(
  env: Env,
  attempt: string,
): Promise<CheckoutLedgerRecord | null> {
  if (!/^[a-f0-9]{64}$/i.test(attempt)) return null;
  const bucket = paymentLedger(env);
  if (!bucket) return null;
  try {
    const stored = await readLedgerJson<CheckoutLedgerRecord>(
      bucket,
      ledgerKey('checkouts', attempt.toLowerCase()),
    );
    return stored?.value ?? null;
  } catch {
    return null;
  }
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
  booking?: { status: CheckoutLedgerRecord['bookingStatus']; eventId?: string },
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
        Number(session?.metadata?.total_amount_cents) ||
        existing?.value.amountCents ||
        amountCentsFrom(session?.amount_total) ||
        0,
      chargeAmountCents:
        existing?.value.chargeAmountCents ??
        amountCentsFrom(session?.amount_total) ??
        0,
      serviceType:
        existing?.value.serviceType ?? session?.metadata?.service_type ?? 'cleaning',
      ...(booking?.status ? { bookingStatus: booking.status } : {}),
      ...(booking?.eventId ? { bookingEventId: booking.eventId } : {}),
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
async function deliverEstimateReceipt(
  env: Env,
  eventId: string,
  session: NonNullable<StripeEvent['data']>['object'],
  amountCents: number | null,
  paidAt: string,
  reference: string,
): Promise<{ status: string; sent: boolean }> {
  const attempt = session?.metadata?.checkout_attempt ?? '';
  const record = await readCheckoutRecord(env, attempt);
  const snapshot = record?.receipt;
  if (!snapshot) return { status: 'not_available', sent: false };
  const customerEmail =
    (session?.customer_details?.email ?? '').trim() || snapshot.customerEmail;
  const customerName =
    (session?.customer_details?.name ?? '').trim() || snapshot.customerName;
  const totalCents = snapshot.totalCents;
  const giftAppliedCents = record?.gift?.appliedCents ?? 0;
  const paidCents =
    (amountCents ?? record?.chargeAmountCents ?? record?.amountCents ?? totalCents) +
    giftAppliedCents;
  const photosOutstanding = session?.metadata?.photos_outstanding === 'yes';
  const bookingConfirmed = session?.metadata?.booking_status === 'confirmed';
  const data: ReceiptData = {
    receiptNumber: `SSR-${reference || record?.reference || eventId.slice(-8)}`,
    reference: reference || record?.reference || '',
    paidAt,
    service: snapshot.service,
    ...(snapshot.serviceLocation ? { serviceLocation: snapshot.serviceLocation } : {}),
    ...(customerName ? { customerName } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    lines: snapshot.lines,
    subtotalCents: snapshot.subtotalCents,
    taxCents: snapshot.taxCents,
    taxRatePercent: snapshot.taxRatePercent,
    taxJurisdiction: snapshot.taxJurisdiction,
    totalCents,
    paidCents,
    balanceCents: Math.max(0, totalCents - paidCents),
    paymentStatus: paidCents >= totalCents ? 'paid' : 'partially_paid',
    ...(session?.id ? { stripeSessionId: session.id } : {}),
    ...(bookingConfirmed
      ? {
          notes:
            'Payment received and the requested appointment is confirmed. Sparkling Standard will send the final arrival details before the cleaning. This receipt is your paid confirmation.',
        }
      : giftAppliedCents > 0
      ? {
          notes: photosOutstanding
            ? 'Payment received with gift-certificate credit. Required photos are still outstanding, so appointment confirmation is pending those photos. Upload them so we can finish confirming.'
            : 'Payment received with gift-certificate credit. Appointment confirmation is pending final eligibility or manual review; we will follow up.',
        }
      : photosOutstanding
        ? {
            notes:
              'Payment received. Required photos are still outstanding, so appointment confirmation is pending those photos. Upload them so we can finish confirming.',
          }
        : {
            notes:
              'Payment received. Appointment confirmation is pending final eligibility or manual review; we will follow up.',
          }),
  };
  const outcome = await sendCustomerReceipt(data, env, `receipt-${eventId}`);
  return { status: describeReceiptOutcome(outcome), sent: outcome.status === 'sent' };
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

  if (event.type === 'checkout.session.expired') {
    const expired = event.data?.object;
    const attempt = expired?.metadata?.checkout_attempt ?? '';
    const expiredKind = expired?.metadata?.checkout_kind;
    if (expiredKind === 'invoice_payment' && env.DB && expired?.metadata?.invoice_id) {
      await env.DB
        .prepare('UPDATE invoices SET payment_url = NULL, stripe_checkout_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stripe_checkout_session_id = ?')
        .bind(expired.metadata.invoice_id, String(expired.id ?? ''))
        .run()
        .catch(() => undefined);
      return json({ ok: true, received: true, expired: true });
    }
    if (expiredKind === 'estimate_payment' && /^[a-f0-9]{64}$/i.test(attempt)) {
      const record = await readCheckoutRecord(env, attempt);
      const bucket = paymentLedger(env);
      const ledger = giftBucket(env);
      if (record?.gift && !record.gift.paidByGift && ledger) {
        await releaseGiftReservation(ledger, record.gift.code, record.gift.reservationId).catch(
          () => undefined,
        );
      }
      if (record && bucket && record.status !== 'completed' && record.status !== 'failed') {
        await writeLedgerJson(bucket, ledgerKey('checkouts', attempt.toLowerCase()), {
          ...record,
          status: 'failed',
          updatedAt: new Date().toISOString(),
        }).catch(() => undefined);
      }
    }
    return json({ ok: true, received: true, expired: true });
  }

  const checkoutObject = event.data?.object;
  if (
    event.type === 'checkout.session.completed' &&
    checkoutObject?.metadata?.checkout_kind === 'saved_card_setup'
  ) {
    if (!env.DB || !env.STRIPE_SECRET_KEY) {
      return json({ ok: false, error: 'saved_card_setup_not_configured' }, 503);
    }
    try {
      const saved = await recordSavedCardSetup(env.DB, {
        ...(checkoutObject.id ? { id: checkoutObject.id } : {}),
        ...(checkoutObject.customer ? { customer: checkoutObject.customer } : {}),
        ...(checkoutObject.setup_intent ? { setup_intent: checkoutObject.setup_intent } : {}),
        ...(checkoutObject.metadata ? { metadata: checkoutObject.metadata } : {}),
      }, env);
      return json({ ok: true, received: true, savedCard: saved.saved });
    } catch {
      return json({ ok: false, error: 'saved_card_setup_failed' }, 500);
    }
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
  if (metadata.checkout_kind === 'invoice_payment') {
    if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 503);
    try {
      const result = await applyInvoiceCheckoutPayment(env.DB, {
        ...(session.id ? { id: session.id } : {}),
        ...(session.payment_intent ? { payment_intent: session.payment_intent } : {}),
        ...(session.customer ? { customer: session.customer } : {}),
        ...(session.amount_total ? { amount_total: session.amount_total } : {}),
        metadata,
      });
      return json({ ok: true, received: true, invoice: result });
    } catch {
      return json({ ok: false, error: 'invoice_payment_reconciliation_failed' }, 500);
    }
  }
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
  const validFromDate = isValidCalendarDate(metadata.valid_from_date ?? '')
    ? metadata.valid_from_date!
    : centralToday(new Date(paidAt));

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
            validFromDate,
            activatesAt: activationInstant(validFromDate),
            ...(metadata.delivery_method === 'recipient_email' || metadata.delivery_method === 'print'
              ? { deliveryMethod: metadata.delivery_method }
              : metadata.recipient_email
                ? { deliveryMethod: 'recipient_email' as const }
                : { deliveryMethod: 'print' as const }),

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
    const checkout = metadata.checkout_attempt
      ? await readCheckoutRecord(env, metadata.checkout_attempt)
      : null;
    if (session.id && metadata.checkout_attempt) {
      const giftAppliedCents = Number(metadata.gift_applied_cents) || 0;
      if (giftAppliedCents > 0) {
        if (!checkout?.gift) {
          if (bucket && record) {
            await failPaymentEvent(bucket, eventId, record, 'gift_reservation_missing');
          }
          return json({ ok: false, error: 'gift_reservation_missing' }, 500);
        }
        if (!checkout.gift.paidByGift) {
          const ledger = giftBucket(env);
          if (!ledger) {
            if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'gift_ledger_not_configured');
            return json({ ok: false, error: 'gift_ledger_not_configured' }, 503);
          }
          const committed = await commitGiftReservation(
            ledger,
            checkout.gift.code,
            checkout.gift.reservationId,
            `Gift credit used for cleaning ${reference || checkout.reference}`,
          );
          if (!committed.ok) {
            console.error('[stripe-webhook] gift_commit_failed', { error: committed.error });
            if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'gift_commit_failed');
            return json({ ok: false, error: 'gift_commit_failed' }, 500);
          }
        }
      }
      let booking:
        | { status: CheckoutLedgerRecord['bookingStatus']; eventId?: string; reason?: string }
        | undefined;
      const holdId = metadata.booking_hold_id ?? '';
      const quoteReference = metadata.quote_reference ?? checkout?.reference ?? '';
      if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-f0-9-]{36}$/.test(holdId)) {
        if (!checkout) {
          booking = { status: 'pending_owner_review', reason: 'checkout_record_missing' };
        } else if (checkout.reference !== quoteReference) {
          booking = { status: 'pending_owner_review', reason: 'quote_reference_mismatch' };
        } else if (checkout.photosOutstanding === true || metadata.photos_outstanding === 'yes') {
          booking = { status: 'pending_owner_review', reason: 'photos_outstanding' };
        } else {
          const confirmed = await autoConfirmPaidBooking(env, holdId, quoteReference);
          booking = confirmed.ok
            ? { status: 'confirmed', eventId: confirmed.eventId }
            : { status: 'pending_owner_review', reason: confirmed.reason };
        }
      }
      if (env.DB && /^[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-f0-9-]{36}$/.test(holdId)) {
        const paymentStatus =
          booking?.status === 'confirmed'
            ? 'paid_confirmed'
            : checkout?.photosOutstanding === true || metadata.photos_outstanding === 'yes'
              ? 'paid_awaiting_photos'
              : 'paid_awaiting_confirmation';
        await env.DB
          .prepare(
            `UPDATE booking_requests SET payment_status = ?, payment_reference = ?,
               payment_amount_cents = ?, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP WHERE hold_id = ?`,
          )
          .bind(
            paymentStatus,
            String(session.payment_intent ?? session.id ?? '').slice(0, 200),
            Number(session.amount_total) || 0,
            holdId,
          )
          .run()
          .catch(() => undefined);
      }
      await updateCheckoutRecord(env, metadata.checkout_attempt, session, booking);
      if (booking?.status === 'confirmed') {
        metadata.booking_status = 'confirmed';
        metadata.booking_event_id = booking.eventId ?? '';
      } else if (booking) {
        metadata.booking_status = 'pending_owner_review';
        metadata.booking_status_reason = booking.reason ?? 'manual_review';
      }
    }

    const amount = amountCents === null ? 'unknown' : (amountCents / 100).toFixed(2);
    const fields: Record<string, string> = {
      'Payment status': 'PAID - verify in Stripe before scheduling',
      'Amount paid': `$${amount} USD${checkout?.gift ? ' (card remainder after gift credit)' : ''}`,
      ...(checkout?.gift
        ? {
            'Gift credit applied': `$${((checkout.gift.appliedCents ?? 0) / 100).toFixed(2)}`,
            'Gift code': checkout.gift.code,
            'Total including gift': `$${((checkout.amountCents ?? 0) / 100).toFixed(2)}`,
          }
        : {}),
      'Quote reference': reference || 'reference unavailable',
      Service: metadata.service_type ?? 'cleaning',
      Customer: customerName || 'name not supplied by Stripe',
      Email: customerEmail || 'email not supplied by Stripe',
      'Stripe event': eventId,
      'Stripe session': session.id ?? '',
      'Checkout attempt': metadata.checkout_attempt ?? '',
      ...(metadata.booking_status
        ? {
            'Booking status':
              metadata.booking_status === 'confirmed'
                ? 'CONFIRMED automatically (verified slot, complete details, paid)'
                : `Pending owner review (${metadata.booking_status_reason ?? 'manual review'})`,
            ...(metadata.booking_event_id
              ? { 'Calendar event id': metadata.booking_event_id }
              : {}),
          }
        : {}),
      'Paid at': paidAt,
      Note:
        metadata.booking_status === 'confirmed'
          ? 'The paid booking was confirmed automatically against the live calendar and resource schedule. Review the scope and arrival details before the visit.'
          : 'The cleaning request was delivered separately by the website lead relay. Confirm the requested date, scope and final details personally before scheduling.',
    };
    const receipt = await deliverEstimateReceipt(
      env,
      eventId,
      session,
      amountCents,
      paidAt,
      reference,
    );
    fields['Receipt email'] = receipt.status;
    if (!receipt.sent && receipt.status.startsWith('failed')) {
      console.error(receipt.status);
    }
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
      validFromDate,
      activatesAt: activationInstant(validFromDate),
      activationTimezone: 'America/Chicago',
      stripeEventId: eventId,
      stripeSessionId: session.id ?? '',
      issuedAt: paidAt,
      history: [],
    });
  } catch {
    if (bucket && record) await failPaymentEvent(bucket, eventId, record, 'gift_issue_failed');
    return json({ ok: false, error: 'gift_issue_failed' }, 500);
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
    validFromDate,
    ...(seed.gift.deliveryMethod ? { deliveryMethod: seed.gift.deliveryMethod } : {}),
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
    validFromDate,
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
  if (seed.gift.deliveryMethod === 'recipient_email' && seed.gift.recipientEmail) {
    const recipientEmail = buildGiftCertificateEmail({
      code,
      valueUsd: seed.gift.valueUsd,
      recipientName: seed.gift.recipientName,
      purchaserName: seed.gift.purchaserName,
      ...(seed.gift.message ? { message: seed.gift.message } : {}),
      validFromDate,
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
      ? 'Sent to purchaser' +
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
  if (bucket && metadata.checkout_attempt) {
    const attemptKey = ledgerKey('gift-checkouts', metadata.checkout_attempt.toLowerCase());
    const stored = await readLedgerJson<Record<string, unknown>>(bucket, attemptKey).catch(() => null);
    if (stored?.value) {
      await writeLedgerJson(bucket, attemptKey, {
        ...stored.value,
        status: 'completed',
        code,
        sessionId: session.id ?? '',
        completedAt: paidAt,
      }).catch(() => undefined);
    }
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
