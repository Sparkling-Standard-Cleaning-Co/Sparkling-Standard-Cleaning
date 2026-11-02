import type { D1Database } from './d1.ts';
import { AdminAuthError, audit, type AdminActor } from './operations.ts';

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export interface RefundRecord {
  id: string;
  payment_id: string;
  amount_cents: number;
  status: string;
  idempotency_key: string | null;
  stripe_refund_id: string | null;
}

/**
 * Recomputes payment and invoice balances from the immutable payment/refund
 * rows rather than decrementing stored totals. This makes retries and multiple
 * partial refunds safe.
 */
export async function recomputePaymentFinancials(
  db: D1Database,
  paymentId: string,
): Promise<void> {
  const payment = await db
    .prepare('SELECT * FROM payments WHERE id = ? LIMIT 1')
    .bind(paymentId)
    .first<Record<string, unknown>>();
  if (!payment) throw new AdminAuthError(404, 'payment_not_found');

  const refundedRow = await db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE payment_id = ? AND status = 'succeeded'",
    )
    .bind(paymentId)
    .first<{ total: number }>();
  const refunded = Math.max(0, Number(refundedRow?.total) || 0);
  const amount = Math.max(0, Number(payment.amount_cents) || 0);
  const current = String(payment.status ?? '');
  const status =
    refunded >= amount && amount > 0
      ? 'refunded'
      : refunded > 0
        ? 'partially_refunded'
        : current === 'partially_refunded' || current === 'refunded'
          ? 'succeeded'
          : current;
  if (status !== current) {
    await db.prepare('UPDATE payments SET status = ? WHERE id = ?').bind(status, paymentId).run();
  }

  const invoiceId = String(payment.invoice_id ?? '');
  if (invoiceId) await recomputeInvoiceFinancials(db, invoiceId);
}

export async function recomputeInvoiceFinancials(
  db: D1Database,
  invoiceId: string,
): Promise<void> {
  const invoice = await db
    .prepare('SELECT id, total_cents, status FROM invoices WHERE id = ? LIMIT 1')
    .bind(invoiceId)
    .first<{ id: string; total_cents: number; status: string }>();
  if (!invoice) return;

  const paidRow = await db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE invoice_id = ? AND status IN ('succeeded', 'partially_refunded', 'refunded')",
    )
    .bind(invoiceId)
    .first<{ total: number }>();
  const refundedRow = await db
    .prepare(
      `SELECT COALESCE(SUM(r.amount_cents), 0) AS total
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.invoice_id = ? AND r.status = 'succeeded'`,
    )
    .bind(invoiceId)
    .first<{ total: number }>();
  const paid = Math.max(0, Number(paidRow?.total) || 0);
  const refunded = Math.max(0, Number(refundedRow?.total) || 0);
  const net = Math.max(0, paid - refunded);
  const total = Math.max(0, Number(invoice.total_cents) || 0);
  const current = String(invoice.status ?? '');
  const status =
    current === 'void'
      ? 'void'
      : total > 0 && net >= total
        ? 'paid'
        : net > 0
          ? 'partially_paid'
          : current === 'draft'
            ? 'draft'
            : 'open';
  const balance = Math.max(0, total - net);

  await db
    .prepare(
      `UPDATE invoices
       SET amount_paid_cents = ?, balance_cents = ?, status = ?,
           payment_url = NULL, stripe_checkout_session_id = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(net, balance, status, now(), invoiceId)
    .run();
}

export async function beginRefund(
  db: D1Database,
  actor: AdminActor,
  input: {
    paymentId: string;
    amountCents: number;
    reason?: string;
    idempotencyKey: string;
    status: 'pending' | 'succeeded';
  },
): Promise<{ id: string; status: string; duplicate: boolean }> {
  const paymentId = text(input.paymentId, 100);
  const amount = Math.round(input.amountCents);
  const idempotencyKey = text(input.idempotencyKey, 200);
  if (!paymentId) throw new AdminAuthError(400, 'payment_required');
  if (amount <= 0) throw new AdminAuthError(400, 'refund_amount_invalid');
  if (!idempotencyKey) throw new AdminAuthError(400, 'refund_idempotency_required');

  const existing = await db
    .prepare('SELECT * FROM refunds WHERE idempotency_key = ? LIMIT 1')
    .bind(idempotencyKey)
    .first<RefundRecord>();
  if (existing) {
    if (existing.payment_id !== paymentId || Number(existing.amount_cents) !== amount) {
      throw new AdminAuthError(409, 'refund_idempotency_conflict');
    }
    // Repair a retry after a previous projection step failed after the refund row
    // was written; the idempotency key still prevents a second refund.
    await recomputePaymentFinancials(db, existing.payment_id);
    return { id: existing.id, status: existing.status, duplicate: true };
  }

  const refundId = `refund_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO refunds
       (id, payment_id, amount_cents, reason, status, idempotency_key, created_by_admin_user_id)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE (
         SELECT COALESCE(SUM(amount_cents), 0) FROM refunds
         WHERE payment_id = ? AND status IN ('pending', 'succeeded')
       ) + ? <= (
         SELECT amount_cents FROM payments WHERE id = ?
       )`,
    )
    .bind(
      refundId,
      paymentId,
      amount,
      text(input.reason, 500),
      input.status,
      idempotencyKey,
      actor.id,
      paymentId,
      amount,
      paymentId,
    )
    .run();

  const created = await db
    .prepare('SELECT * FROM refunds WHERE idempotency_key = ? LIMIT 1')
    .bind(idempotencyKey)
    .first<RefundRecord>();
  if (!created) throw new AdminAuthError(400, 'refund_exceeds_remaining');
  if (created.payment_id !== paymentId || Number(created.amount_cents) !== amount) {
    throw new AdminAuthError(409, 'refund_idempotency_conflict');
  }
  await recomputePaymentFinancials(db, paymentId);
  return { id: created.id, status: created.status, duplicate: false };
}

export async function completeRefund(
  db: D1Database,
  actor: AdminActor,
  refundId: string,
  stripeRefundId?: string,
): Promise<void> {
  const refund = await db
    .prepare('SELECT * FROM refunds WHERE id = ? LIMIT 1')
    .bind(refundId)
    .first<RefundRecord>();
  if (!refund) throw new AdminAuthError(404, 'refund_not_found');
  if (refund.status === 'succeeded') {
    await recomputePaymentFinancials(db, refund.payment_id);
    return;
  }
  if (refund.status !== 'pending') throw new AdminAuthError(409, 'refund_not_pending');
  await db
    .prepare(
      "UPDATE refunds SET status = 'succeeded', stripe_refund_id = COALESCE(?, stripe_refund_id) WHERE id = ? AND status = 'pending'",
    )
    .bind(text(stripeRefundId, 200) || null, refundId)
    .run();
  await recomputePaymentFinancials(db, refund.payment_id);
  await audit(db, {
    actorUserId: actor.id,
    action: 'refund.succeeded',
    entityType: 'refund',
    entityId: refundId,
    detail: String(refund.amount_cents),
  });
}

export async function failRefund(
  db: D1Database,
  actor: AdminActor,
  refundId: string,
  detail: string,
): Promise<void> {
  const refund = await db
    .prepare('SELECT * FROM refunds WHERE id = ? LIMIT 1')
    .bind(refundId)
    .first<RefundRecord>();
  if (!refund) throw new AdminAuthError(404, 'refund_not_found');
  if (refund.status === 'failed') return;
  if (refund.status !== 'pending') throw new AdminAuthError(409, 'refund_not_pending');
  await db.prepare("UPDATE refunds SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(refundId).run();
  await recomputePaymentFinancials(db, refund.payment_id);
  await audit(db, {
    actorUserId: actor.id,
    action: 'refund.failed',
    entityType: 'refund',
    entityId: refundId,
    success: false,
    detail: text(detail, 500),
  });
}

export async function projectStripeRefund(
  db: D1Database,
  input: {
    paymentId: string;
    stripeRefundId: string;
    amountCents: number;
    status: 'pending' | 'succeeded' | 'failed';
    reason?: string;
  },
): Promise<{ refundId: string; duplicate: boolean }> {
  const stripeRefundId = text(input.stripeRefundId, 200);
  if (!stripeRefundId) throw new AdminAuthError(400, 'stripe_refund_id_required');
  const existing = await db
    .prepare('SELECT * FROM refunds WHERE stripe_refund_id = ? LIMIT 1')
    .bind(stripeRefundId)
    .first<RefundRecord>();
  if (existing) {
    if (existing.status !== input.status) {
      await db
        .prepare('UPDATE refunds SET status = ? WHERE id = ?')
        .bind(input.status, existing.id)
        .run();
      await recomputePaymentFinancials(db, existing.payment_id);
    }
    return { refundId: existing.id, duplicate: true };
  }
  const refundId = `refund_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO refunds
       (id, payment_id, amount_cents, reason, status, stripe_refund_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      refundId,
      input.paymentId,
      Math.max(0, Math.round(input.amountCents)),
      text(input.reason, 500),
      input.status,
      stripeRefundId,
      `stripe-refund:${stripeRefundId}`,
    )
    .run();
  const stored = await db
    .prepare('SELECT id FROM refunds WHERE stripe_refund_id = ? LIMIT 1')
    .bind(stripeRefundId)
    .first<{ id: string }>();
  if (!stored) throw new Error('refund_projection_failed');
  await recomputePaymentFinancials(db, input.paymentId);
  return { refundId: stored.id, duplicate: false };
}

export async function projectStripeDispute(
  db: D1Database,
  input: {
    paymentId: string | null;
    disputeId: string;
    status: string;
    amountCents: number;
    currency?: string;
    reason?: string;
    evidenceDueBy?: string | null;
  },
): Promise<void> {
  const allowed = new Set([
    'warning_needs_response',
    'needs_response',
    'under_review',
    'won',
    'lost',
    'charge_refunded',
    'closed',
  ]);
  const status = allowed.has(input.status) ? input.status : 'unknown';
  const existing = await db
    .prepare('SELECT id FROM payment_disputes WHERE provider_dispute_id = ? LIMIT 1')
    .bind(input.disputeId)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        'UPDATE payment_disputes SET status = ?, amount_cents = ?, reason = ?, evidence_due_by = ?, updated_at = ? WHERE id = ?',
      )
      .bind(
        status,
        Math.max(0, Math.round(input.amountCents)),
        text(input.reason, 500),
        input.evidenceDueBy ?? null,
        now(),
        existing.id,
      )
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO payment_disputes
       (id, payment_id, provider_dispute_id, status, amount_cents, currency, reason, evidence_due_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `dispute_${crypto.randomUUID()}`,
      input.paymentId,
      input.disputeId,
      status,
      Math.max(0, Math.round(input.amountCents)),
      text(input.currency, 10).toUpperCase() || 'USD',
      text(input.reason, 500),
      input.evidenceDueBy ?? null,
    )
    .run();
}

export async function recordReconciliationIssue(
  db: D1Database,
  input: { eventId: string; kind: string; detail: string; payload?: unknown },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO payment_reconciliation_issues
       (id, provider_event_id, kind, detail, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      `issue_${crypto.randomUUID()}`,
      text(input.eventId, 200) || 'unknown',
      text(input.kind, 100),
      text(input.detail, 500),
      JSON.stringify(input.payload ?? {}),
    )
    .run();
}
