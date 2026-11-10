import type { D1Database } from '../admin/d1.ts';

export const FINANCIAL_SYSTEM_CUSTOMER_ID = 'customer_financial_system';

export type FinancialPartyKind = 'service_payer' | 'gift_purchaser' | 'gift_recipient';

interface PartyInput {
  kind: FinancialPartyKind;
  name?: string;
  email?: string;
  stripeCustomerId?: string;
  customerId?: string | null;
  branchId?: string | null;
  stableKey?: string;
}

interface PartyResult {
  id: string;
  customerId: string | null;
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizedEmail(value: unknown): string {
  return text(value, 320).toLowerCase();
}

function now(): string {
  return new Date().toISOString();
}

async function customerForEmail(db: D1Database, email: string): Promise<string | null> {
  if (!email) return null;
  const row = await db
    .prepare(
      "SELECT customer_id FROM customer_contacts WHERE kind = 'email' AND normalized_value = ? LIMIT 1",
    )
    .bind(email)
    .first<{ customer_id: string }>();
  return row?.customer_id ?? null;
}

export async function ensureFinancialParty(
  db: D1Database,
  input: PartyInput,
): Promise<PartyResult> {
  const email = normalizedEmail(input.email);
  const stripeCustomerId = text(input.stripeCustomerId, 200) || null;
  const linkedCustomer =
    text(input.customerId, 100) || (await customerForEmail(db, email));

  if (stripeCustomerId) {
    const byStripe = await db
      .prepare('SELECT id, customer_id FROM financial_parties WHERE stripe_customer_id = ? LIMIT 1')
      .bind(stripeCustomerId)
      .first<{ id: string; customer_id: string | null }>();
    if (byStripe) return { id: byStripe.id, customerId: byStripe.customer_id };
  }
  if (email) {
    const byEmail = await db
      .prepare(
        'SELECT id, customer_id FROM financial_parties WHERE kind = ? AND email_normalized = ? LIMIT 1',
      )
      .bind(input.kind, email)
      .first<{ id: string; customer_id: string | null }>();
    if (byEmail) {
      if (linkedCustomer && !byEmail.customer_id) {
        await db
          .prepare('UPDATE financial_parties SET customer_id = ?, updated_at = ? WHERE id = ?')
          .bind(linkedCustomer, now(), byEmail.id)
          .run();
        return { id: byEmail.id, customerId: linkedCustomer };
      }
      return { id: byEmail.id, customerId: byEmail.customer_id };
    }
  }

  const id = `party_${input.stableKey ?? crypto.randomUUID()}`.slice(0, 200);
  try {
    await db
      .prepare(
        `INSERT INTO financial_parties
         (id, branch_id, kind, display_name, email, email_normalized, stripe_customer_id, customer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        text(input.branchId, 100) || null,
        input.kind,
        text(input.name, 200),
        text(input.email, 320),
        email,
        stripeCustomerId,
        linkedCustomer,
      )
      .run();
    return { id, customerId: linkedCustomer };
  } catch (error) {
    const existing = await db
      .prepare(
        `SELECT id, customer_id FROM financial_parties
         WHERE (stripe_customer_id = ? AND ? IS NOT NULL)
            OR (kind = ? AND email_normalized = ? AND email_normalized <> '')
            OR id = ?
         LIMIT 1`,
      )
      .bind(stripeCustomerId, stripeCustomerId, input.kind, email, id)
      .first<{ id: string; customer_id: string | null }>();
    if (!existing) {
      const detail = error instanceof Error ? error.message : 'unknown';
      throw new Error(`financial_party_insert_failed:${detail}`);
    }
    return { id: existing.id, customerId: existing.customer_id };
  }
}

export interface ProjectedPaymentInput {
  sessionId: string;
  paymentIntentId?: string;
  chargeId?: string;
  amountCents: number;
  currency?: string;
  customerId?: string | null;
  stripeCustomerId?: string;
  payerPartyId?: string | null;
  bookingRequestId?: string | null;
  appointmentId?: string | null;
  giftCertificateId?: string | null;
  paidAt: string;
  metadata: Record<string, unknown>;
}

export async function projectStripePayment(
  db: D1Database,
  input: ProjectedPaymentInput,
): Promise<{ applied: boolean; duplicate: boolean; paymentId: string; idempotencyKey: string }> {
  const sessionId = text(input.sessionId, 200);
  if (!sessionId) throw new Error('stripe_session_missing');
  const amount = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('payment_amount_invalid');
  const currency = text(input.currency, 10).toUpperCase() || 'USD';
  const idempotencyKey = `stripe-checkout:${sessionId}`;
  const existing = await db
    .prepare(
      'SELECT id, amount_cents, currency, status FROM payments WHERE idempotency_key = ? LIMIT 1',
    )
    .bind(idempotencyKey)
    .first<{ id: string; amount_cents: number; currency: string; status: string }>();
  if (existing) {
    if (Number(existing.amount_cents) !== amount || String(existing.currency).toUpperCase() !== currency) {
      throw new Error('payment_projection_conflict');
    }
    return { applied: false, duplicate: true, paymentId: existing.id, idempotencyKey };
  }

  const paymentId = `payment_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO payments
       (id, branch_id, customer_id, payer_party_id, invoice_id, appointment_id,
        booking_request_id, gift_certificate_id, provider, status, amount_cents, currency,
        stripe_customer_id, stripe_payment_intent_id, stripe_charge_id, idempotency_key,
        received_at, metadata_json)
       VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, 'stripe', 'succeeded', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      paymentId,
      text(input.customerId, 100) || FINANCIAL_SYSTEM_CUSTOMER_ID,
      text(input.payerPartyId, 200) || null,
      text(input.appointmentId, 100) || null,
      text(input.bookingRequestId, 100) || null,
      text(input.giftCertificateId, 100) || null,
      amount,
      currency,
      text(input.stripeCustomerId, 200) || null,
      text(input.paymentIntentId, 200) || null,
      text(input.chargeId, 200) || null,
      idempotencyKey,
      input.paidAt,
      JSON.stringify(input.metadata),
    )
    .run();
  return { applied: true, duplicate: false, paymentId, idempotencyKey };
}

export interface GiftCleaningProjectionInput {
  code: string;
  sessionId: string;
  holdId?: string;
  quoteReference?: string;
  amountCents: number;
  paidAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Projects a gift-covered cleaning into the canonical payment ledger and the
 * booking-request payment summary. The gift ledger is authoritative for the
 * balance; this record makes the financial event visible to invoicing,
 * reporting and refunds instead of leaving a gift-only order outside the
 * payment lifecycle.
 */
export async function projectGiftCleaningPayment(
  db: D1Database,
  input: GiftCleaningProjectionInput,
): Promise<{
  paymentId: string;
  duplicate: boolean;
  bookingRequestId: string | null;
  duplicateBookingPayment: boolean;
}> {
  const holdId = text(input.holdId, 120);
  const quoteReference = text(input.quoteReference, 120);
  const code = text(input.code, 40).toUpperCase();
  const amount = Math.round(Number(input.amountCents));
  if (!code || !Number.isFinite(amount) || amount <= 0) throw new Error('gift_payment_invalid');
  const booking = holdId
    ? await db
        .prepare('SELECT id, customer_id FROM booking_requests WHERE hold_id = ? LIMIT 1')
        .bind(holdId)
        .first<{ id: string; customer_id: string | null }>()
    : quoteReference
      ? await db
          .prepare('SELECT id, customer_id FROM booking_requests WHERE quote_reference = ? ORDER BY created_at DESC LIMIT 1')
          .bind(quoteReference)
          .first<{ id: string; customer_id: string | null }>()
      : null;
  const paymentId = `payment_${crypto.randomUUID()}`;
  const idempotencyKey = `gift-cleaning:${code}:${text(input.sessionId, 200) || quoteReference || holdId}`;
  const existing = await db
    .prepare('SELECT id FROM payments WHERE idempotency_key = ? LIMIT 1')
    .bind(idempotencyKey)
    .first<{ id: string }>();
  if (existing) {
    return {
      paymentId: existing.id,
      duplicate: true,
      bookingRequestId: booking?.id ?? null,
      duplicateBookingPayment: false,
    };
  }
  const giftSessionId = `gift:${code}:${text(input.sessionId, 200) || quoteReference || holdId}`;
  const claim = booking
    ? await claimBookingPayment(db, {
        bookingRequestId: booking.id,
        sessionId: giftSessionId,
        amountCents: amount,
      })
    : null;
  const statements = [
    db
      .prepare(
        `INSERT INTO payments
         (id, branch_id, customer_id, payer_party_id, invoice_id, appointment_id,
          booking_request_id, gift_certificate_id, provider, status, amount_cents, currency,
          stripe_customer_id, stripe_payment_intent_id, stripe_charge_id, idempotency_key,
          received_at, metadata_json)
         VALUES (?, NULL, ?, NULL, NULL, NULL, ?, NULL, 'external', 'succeeded', ?, 'USD',
                 NULL, NULL, NULL, ?, ?, ?)`,
      )
      .bind(
        paymentId,
        booking?.customer_id ?? FINANCIAL_SYSTEM_CUSTOMER_ID,
        booking?.id ?? null,
        amount,
        idempotencyKey,
        input.paidAt,
        JSON.stringify({
          checkout_kind: 'estimate',
          payment_method: 'gift_certificate',
          gift_code: code,
          quote_reference: quoteReference,
          booking_hold_id: holdId,
          duplicate_booking_payment: claim?.duplicate === true,
          ...(claim?.duplicate ? { primary_payment_session_id: claim.primarySessionId } : {}),
          ...(input.metadata ?? {}),
        }),
      ),
  ];
  if (booking) {
    statements.push(
      db
        .prepare(
          `UPDATE booking_requests SET payment_status = 'paid_gift', payment_reference = ?,
             payment_amount_cents = COALESCE(payment_amount_cents, 0) + ?,
             paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ?`,
        )
        .bind(code, amount, input.paidAt, new Date().toISOString(), booking.id),
    );
  }
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  return {
    paymentId,
    duplicate: false,
    bookingRequestId: booking?.id ?? null,
    duplicateBookingPayment: claim?.duplicate === true,
  };
}

export interface GiftSaleProjectionInput {
  code: string;
  sessionId: string;
  paymentIntentId?: string;
  amountCents: number;
  currency?: string;
  valueCents: number;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail?: string;
  message?: string;
  deliveryMethod: 'recipient_email' | 'print';
  validFromDate?: string;
  activatesAt?: string;
  eventId: string;
  paidAt: string;
  termsVersion?: string;
}

export async function projectGiftSale(
  db: D1Database,
  input: GiftSaleProjectionInput,
): Promise<{ giftCertificateId: string; paymentId: string; duplicate: boolean }> {
  const code = text(input.code, 40).toUpperCase();
  if (!code) throw new Error('gift_code_missing');
  const valueCents = Math.round(Number(input.valueCents));
  if (valueCents <= 0) throw new Error('gift_value_invalid');
  const purchaser = await ensureFinancialParty(db, {
    kind: 'gift_purchaser',
    name: input.purchaserName,
    email: input.purchaserEmail,
    stableKey: `${code}-purchaser`,
  });
  const recipient = await ensureFinancialParty(db, {
    kind: 'gift_recipient',
    name: input.recipientName,
    email: input.recipientEmail ?? '',
    stableKey: `${code}-recipient`,
  });

  const existing = await db
    .prepare(
      'SELECT id, stripe_session_id, value_cents FROM gift_certificates WHERE code = ? LIMIT 1',
    )
    .bind(code)
    .first<{ id: string; stripe_session_id: string | null; value_cents: number }>();
  let giftCertificateId = existing?.id ?? `gift_${code}`;
  if (existing) {
    if (existing.stripe_session_id && existing.stripe_session_id !== input.sessionId) {
      throw new Error('gift_projection_conflict');
    }
    if (Number(existing.value_cents) !== valueCents) throw new Error('gift_projection_conflict');
    await db
      .prepare(
        `UPDATE gift_certificates
         SET purchaser_party_id = COALESCE(purchaser_party_id, ?),
             recipient_party_id = COALESCE(recipient_party_id, ?),
             purchaser_customer_id = COALESCE(purchaser_customer_id, ?),
             recipient_customer_id = COALESCE(recipient_customer_id, ?),
             purchaser_name = CASE WHEN purchaser_name = '' THEN ? ELSE purchaser_name END,
             purchaser_email = CASE WHEN purchaser_email = '' THEN ? ELSE purchaser_email END,
             recipient_name = CASE WHEN recipient_name = '' THEN ? ELSE recipient_name END,
             recipient_email = CASE WHEN recipient_email = '' THEN ? ELSE recipient_email END,
             message = CASE WHEN message = '' THEN ? ELSE message END,
             delivery_method = CASE WHEN delivery_method = '' THEN ? ELSE delivery_method END,
             delivery_status = CASE WHEN delivery_status = '' THEN 'pending' ELSE delivery_status END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        purchaser.id,
        recipient.id,
        purchaser.customerId,
        recipient.customerId,
        text(input.purchaserName, 200),
        text(input.purchaserEmail, 320),
        text(input.recipientName, 200),
        text(input.recipientEmail, 320),
        text(input.message, 1000),
        input.deliveryMethod,
        now(),
        giftCertificateId,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO gift_certificates
         (id, code, branch_id, purchaser_customer_id, recipient_customer_id,
          purchaser_party_id, recipient_party_id, status, value_cents, balance_cents,
          valid_from_date, activates_at, stripe_event_id, stripe_session_id, terms_version,
          purchaser_name, purchaser_email, recipient_name, recipient_email, message,
          delivery_method, delivery_status)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .bind(
        giftCertificateId,
        code,
        purchaser.customerId,
        recipient.customerId,
        purchaser.id,
        recipient.id,
        valueCents,
        valueCents,
        text(input.validFromDate, 10) || null,
        text(input.activatesAt, 40) || null,
        text(input.eventId, 200),
        text(input.sessionId, 200),
        text(input.termsVersion, 80) || '2026-11-02.gift',
        text(input.purchaserName, 200),
        text(input.purchaserEmail, 320),
        text(input.recipientName, 200),
        text(input.recipientEmail, 320),
        text(input.message, 1000),
        input.deliveryMethod,
      )
      .run();
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO gift_transactions
       (id, gift_certificate_id, kind, amount_cents, reference)
       VALUES (?, ?, 'issue', ?, ?)`,
    )
    .bind(`gift_tx_issue_${code}`, giftCertificateId, valueCents, input.sessionId)
    .run();

  const payment = await projectStripePayment(db, {
    sessionId: input.sessionId,
    ...(input.paymentIntentId ? { paymentIntentId: input.paymentIntentId } : {}),
    amountCents: input.amountCents,
    ...(input.currency ? { currency: input.currency } : {}),
    customerId: purchaser.customerId,
    payerPartyId: purchaser.id,
    giftCertificateId,
    paidAt: input.paidAt,
    metadata: {
      checkout_kind: 'gift',
      gift_code: code,
      gift_value_cents: valueCents,
      purchaser_name: input.purchaserName,
      purchaser_email: input.purchaserEmail,
      recipient_name: input.recipientName,
      recipient_email: input.recipientEmail ?? '',
      delivery_method: input.deliveryMethod,
      stripe_event_id: input.eventId,
    },
  });
  return { giftCertificateId, paymentId: payment.paymentId, duplicate: payment.duplicate };
}

export interface BookingPaymentClaim {
  duplicate: boolean;
  primarySessionId: string;
  primaryPaymentIntentId: string;
  claimedAt: string;
}

/**
 * Atomically claims the primary successful payment for one booking request.
 * The first settlement wins; any later settlement is reported as a duplicate so
 * the owner can refund it without ever losing the financial record.
 */
export async function claimBookingPayment(
  db: D1Database,
  input: {
    bookingRequestId: string;
    sessionId: string;
    paymentIntentId?: string;
    amountCents: number;
  },
): Promise<BookingPaymentClaim | null> {
  const bookingRequestId = text(input.bookingRequestId, 120);
  const sessionId = text(input.sessionId, 200);
  if (!bookingRequestId || !sessionId) return null;
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO booking_payment_claims
       (booking_request_id, stripe_session_id, payment_intent_id, amount_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      bookingRequestId,
      sessionId,
      text(input.paymentIntentId, 200),
      Math.max(0, Math.round(Number(input.amountCents) || 0)),
      timestamp,
      timestamp,
    )
    .run();
  const row = await db
    .prepare(
      `SELECT stripe_session_id, payment_intent_id, created_at
       FROM booking_payment_claims WHERE booking_request_id = ? LIMIT 1`,
    )
    .bind(bookingRequestId)
    .first<{ stripe_session_id: string; payment_intent_id: string; created_at: string }>();
  if (!row) return null;
  return {
    duplicate: row.stripe_session_id !== sessionId,
    primarySessionId: row.stripe_session_id,
    primaryPaymentIntentId: row.payment_intent_id,
    claimedAt: row.created_at,
  };
}

export interface EstimatePaymentProjectionInput {
  sessionId: string;
  paymentIntentId?: string;
  amountCents: number;
  currency?: string;
  holdId?: string;
  quoteReference?: string;
  checkoutAttempt?: string;
  /** Durable Stripe Customer linked at checkout (when available). */
  stripeCustomerId?: string;
  customerId?: string;
  giftAppliedCents?: number;
  totalCents?: number;
  customerName?: string;
  customerEmail?: string;
  paidAt: string;
  duplicateBookingPayment?: boolean;
  metadata?: Record<string, unknown>;
}

export async function projectEstimatePayment(
  db: D1Database,
  input: EstimatePaymentProjectionInput,
): Promise<{
  paymentId: string;
  duplicate: boolean;
  bookingRequestId: string | null;
  appointmentId: string | null;
  duplicateBookingPayment: boolean;
  primaryPaymentSessionId: string;
}> {
  const holdId = text(input.holdId, 120);
  const quoteReference = text(input.quoteReference, 120);
  const booking = holdId
    ? await db
        .prepare('SELECT id, customer_id FROM booking_requests WHERE hold_id = ? LIMIT 1')
        .bind(holdId)
        .first<{ id: string; customer_id: string | null }>()
    : quoteReference
      ? await db
          .prepare('SELECT id, customer_id FROM booking_requests WHERE quote_reference = ? ORDER BY created_at DESC LIMIT 1')
          .bind(quoteReference)
          .first<{ id: string; customer_id: string | null }>()
      : null;
  const appointment = booking
    ? await db
        .prepare('SELECT id FROM appointments WHERE booking_request_id = ? ORDER BY created_at DESC LIMIT 1')
        .bind(booking.id)
        .first<{ id: string }>()
    : null;
  const claim = booking
    ? await claimBookingPayment(db, {
        bookingRequestId: booking.id,
        sessionId: input.sessionId,
        ...(input.paymentIntentId ? { paymentIntentId: input.paymentIntentId } : {}),
        amountCents: input.amountCents,
      })
    : null;

  let payerPartyId: string | null = null;
  if (!booking?.customer_id) {
    const party = await ensureFinancialParty(db, {
      kind: 'service_payer',
      name: input.customerName ?? '',
      email: input.customerEmail ?? '',
      stableKey: input.sessionId,
      ...(input.stripeCustomerId ? { stripeCustomerId: input.stripeCustomerId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
    });
    payerPartyId = party.id;
  }

  const payment = await projectStripePayment(db, {
    sessionId: input.sessionId,
    ...(input.paymentIntentId ? { paymentIntentId: input.paymentIntentId } : {}),
    amountCents: input.amountCents,
    ...(input.currency ? { currency: input.currency } : {}),
    customerId: booking?.customer_id ?? input.customerId ?? null,
    ...(input.stripeCustomerId ? { stripeCustomerId: input.stripeCustomerId } : {}),
    payerPartyId,
    bookingRequestId: booking?.id ?? null,
    appointmentId: appointment?.id ?? null,
    paidAt: input.paidAt,
    metadata: {
      checkout_kind: 'estimate',
      quote_reference: quoteReference,
      booking_hold_id: holdId,
      checkout_attempt: input.checkoutAttempt ?? '',
      gift_applied_cents: Math.max(0, Math.round(Number(input.giftAppliedCents) || 0)),
      total_cents: Math.max(0, Math.round(Number(input.totalCents) || input.amountCents)),
      duplicate_booking_payment: input.duplicateBookingPayment ?? claim?.duplicate === true,
      ...(claim?.duplicate ? { primary_payment_session_id: claim.primarySessionId } : {}),
      ...(input.metadata ?? {}),
    },
  });
  const linkedCustomer = booking?.customer_id ?? input.customerId ?? null;
  if (linkedCustomer && input.stripeCustomerId) {
    await db
      .prepare(
        `UPDATE customers SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = '')`,
      )
      .bind(input.stripeCustomerId, linkedCustomer)
      .run()
      .catch(() => undefined);
  }
  return {
    paymentId: payment.paymentId,
    duplicate: payment.duplicate,
    bookingRequestId: booking?.id ?? null,
    appointmentId: appointment?.id ?? null,
    duplicateBookingPayment: claim?.duplicate === true,
    primaryPaymentSessionId: claim?.primarySessionId ?? input.sessionId,
  };
}

