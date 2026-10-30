import type { D1Database } from './d1.ts';

export interface StripeInvoiceSession {
  id?: string;
  payment_intent?: string;
  customer?: string;
  amount_total?: number;
  metadata?: Record<string, string>;
}

export async function applyInvoiceCheckoutPayment(
  db: D1Database,
  session: StripeInvoiceSession,
): Promise<{ applied: boolean; invoiceId: string; duplicate: boolean }> {
  const metadata = session.metadata ?? {};
  const invoiceId = String(metadata.invoice_id ?? '');
  if (!invoiceId) throw new Error('invoice_id_missing');
  const amount = Math.max(0, Math.round(Number(session.amount_total) || 0));
  if (amount <= 0) throw new Error('invoice_amount_missing');
  const idempotencyKey = `stripe-checkout:${String(session.id ?? '')}`;
  const invoice = await db
    .prepare('SELECT * FROM invoices WHERE id = ? LIMIT 1')
    .bind(invoiceId)
    .first<Record<string, unknown>>();
  if (!invoice) throw new Error('invoice_not_found');
  const existing = await db
    .prepare('SELECT id FROM payments WHERE idempotency_key = ? LIMIT 1')
    .bind(idempotencyKey)
    .first<{ id: string }>();
  if (existing) return { applied: false, invoiceId, duplicate: true };
  const paymentId = `payment_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO payments
       (id, branch_id, customer_id, invoice_id, provider, status, amount_cents, currency,
        stripe_customer_id, stripe_payment_intent_id, idempotency_key, received_at, metadata_json)
       VALUES (?, ?, ?, ?, 'stripe', 'succeeded', ?, 'USD', ?, ?, ?, ?, ?)`,
    )
    .bind(
      paymentId,
      invoice.branch_id ?? null,
      invoice.customer_id,
      invoiceId,
      amount,
      String(session.customer ?? '') || null,
      String(session.payment_intent ?? '') || null,
      idempotencyKey,
      new Date().toISOString(),
      JSON.stringify({ checkout_session_id: session.id ?? '', source: 'stripe_webhook' }),
    )
    .run();
  const paid = Number(invoice.amount_paid_cents) + amount;
  const balance = Math.max(0, Number(invoice.balance_cents) - amount);
  await db
    .prepare(
      `UPDATE invoices SET amount_paid_cents = ?, balance_cents = ?, status = ?,
         payment_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(paid, balance, balance === 0 ? 'paid' : 'partially_paid', invoiceId)
    .run();
  await db
    .prepare(
      `INSERT INTO admin_audit
       (id, actor_user_id, action, entity_type, entity_id, success, detail_json)
       VALUES (?, NULL, 'invoice.stripe_paid', 'invoice', ?, 1, ?)`,
    )
    .bind(`audit_${crypto.randomUUID()}`, invoiceId, JSON.stringify({ paymentId, amount }))
    .run();
  return { applied: true, invoiceId, duplicate: false };
}
