import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import type { D1Database } from './d1.ts';

export interface StripeBillingEnv {
  STRIPE_SECRET_KEY?: string;
  PUBLIC_SITE_URL?: string;
  ADMIN_STRIPE_BILLING_ENABLED?: string;
  ADMIN_STRIPE_REFUNDS_ENABLED?: string;
}

export interface StripeBillingResult {
  url: string;
  sessionId: string;
}

async function stripeRequest(
  env: StripeBillingEnv,
  path: string,
  form: URLSearchParams,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new AdminAuthError(503, 'stripe_not_configured');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    } as HeadersInit,
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = data.error as Record<string, unknown> | undefined;
    throw new AdminAuthError(502, String(error?.code ?? error?.message ?? 'stripe_failed'));
  }
  return data;
}

async function customerForInvoice(
  db: D1Database,
  invoice: Record<string, unknown>,
  env: StripeBillingEnv,
): Promise<string> {
  const existing = await db
    .prepare('SELECT stripe_customer_id FROM customers WHERE id = ? LIMIT 1')
    .bind(String(invoice.customer_id ?? ''))
    .first<{ stripe_customer_id: string | null }>();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;
  const contact = await db
    .prepare("SELECT value FROM customer_contacts WHERE customer_id = ? AND kind = 'email' ORDER BY is_primary DESC LIMIT 1")
    .bind(String(invoice.customer_id ?? ''))
    .first<{ value: string }>();
  if (!contact?.value) throw new AdminAuthError(400, 'customer_email_required');
  const form = new URLSearchParams();
  form.set('email', contact.value);
  form.set('name', [invoice.first_name, invoice.last_name].filter(Boolean).join(' ') || contact.value);
  form.set('metadata[customer_id]', String(invoice.customer_id ?? ''));
  const customer = await stripeRequest(env, 'customers', form, `invoice-customer-${String(invoice.customer_id ?? '')}`);
  const stripeCustomerId = String(customer.id ?? '');
  if (!stripeCustomerId) throw new AdminAuthError(502, 'stripe_customer_failed');
  await db
    .prepare('UPDATE customers SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(stripeCustomerId, String(invoice.customer_id ?? ''))
    .run();
  return stripeCustomerId;
}

export async function createInvoicePaymentLink(
  db: D1Database,
  actor: AdminActor,
  invoiceId: string,
  env: StripeBillingEnv,
): Promise<StripeBillingResult> {
  if (env.ADMIN_STRIPE_BILLING_ENABLED !== 'true') {
    throw new AdminAuthError(503, 'stripe_billing_disabled');
  }
  const result = await db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name FROM invoices i
       JOIN customers c ON c.id = i.customer_id WHERE i.id = ? LIMIT 1`,
    )
    .bind(invoiceId)
    .first<Record<string, unknown>>();
  if (!result) throw new AdminAuthError(404, 'invoice_not_found');
  if (agentScope(actor) && result.branch_id !== actor.branchId) throw new AdminAuthError(403, 'forbidden');
  if (!['open', 'partially_paid', 'overdue'].includes(String(result.status))) {
    throw new AdminAuthError(409, 'invoice_not_payable');
  }
  const balance = Number(result.balance_cents) || 0;
  if (balance <= 0) throw new AdminAuthError(409, 'invoice_paid');
  if (result.payment_url) {
    return { url: String(result.payment_url), sessionId: String(result.stripe_checkout_session_id ?? '') };
  }
  const origin = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
  const stripeCustomerId = await customerForInvoice(db, result, env);
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('customer', stripeCustomerId);
  form.set('client_reference_id', invoiceId);
  form.set('success_url', `${origin}/invoice-payment/?status=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/invoice-payment/?status=cancelled`);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][unit_amount]', String(balance));
  form.set('line_items[0][price_data][product_data][name]', `Sparkling Standard invoice ${String(result.number ?? '')}`);
  form.set('metadata[checkout_kind]', 'invoice_payment');
  form.set('metadata[invoice_id]', invoiceId);
  form.set('metadata[customer_id]', String(result.customer_id ?? ''));
  form.set('payment_intent_data[metadata][invoice_id]', invoiceId);
  const session = await stripeRequest(env, 'checkout/sessions', form, `invoice-checkout-${invoiceId}-${balance}`);
  const url = String(session.url ?? '');
  const sessionId = String(session.id ?? '');
  if (!url || !sessionId) throw new AdminAuthError(502, 'stripe_session_failed');
  await db
    .prepare('UPDATE invoices SET payment_url = ?, stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(url, sessionId, invoiceId)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'invoice.payment_link_created', entityType: 'invoice', entityId: invoiceId });
  return { url, sessionId };
}

function agentScope(actor: AdminActor): boolean {
  return actor.role !== 'owner' && Boolean(actor.branchId);
}

export async function refundStripePayment(
  db: D1Database,
  actor: AdminActor,
  paymentId: string,
  amountCents: number,
  env: StripeBillingEnv,
): Promise<{ refundId: string }> {
  if (env.ADMIN_STRIPE_REFUNDS_ENABLED !== 'true') throw new AdminAuthError(503, 'stripe_refunds_disabled');
  const payment = await db
    .prepare("SELECT * FROM payments WHERE id = ? AND provider = 'stripe' LIMIT 1")
    .bind(paymentId)
    .first<Record<string, unknown>>();
  if (!payment) throw new AdminAuthError(404, 'stripe_payment_not_found');
  if (agentScope(actor) && payment.branch_id !== actor.branchId) throw new AdminAuthError(403, 'forbidden');
  const intent = String(payment.stripe_payment_intent_id ?? '');
  if (!intent) throw new AdminAuthError(400, 'stripe_payment_intent_missing');
  const amount = Math.round(amountCents);
  if (amount <= 0 || amount > Number(payment.amount_cents)) throw new AdminAuthError(400, 'refund_amount_invalid');
  const form = new URLSearchParams();
  form.set('payment_intent', intent);
  form.set('amount', String(amount));
  const refund = await stripeRequest(env, 'refunds', form, `invoice-refund-${paymentId}-${amount}`);
  const refundId = String(refund.id ?? '');
  if (!refundId) throw new AdminAuthError(502, 'stripe_refund_failed');
  await db
    .prepare(
      `INSERT OR IGNORE INTO refunds (id, payment_id, amount_cents, reason, status, stripe_refund_id, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, 'succeeded', ?, ?)`,
    )
    .bind(`refund_${crypto.randomUUID()}`, paymentId, amount, 'admin stripe refund', refundId, actor.id)
    .run();
  const full = amount >= Number(payment.amount_cents);
  await db.prepare('UPDATE payments SET status = ? WHERE id = ?').bind(full ? 'refunded' : 'partially_refunded', paymentId).run();
  const invoiceId = String(payment.invoice_id ?? '');
  if (invoiceId) {
    const invoice = await db
      .prepare('SELECT amount_paid_cents, total_cents FROM invoices WHERE id = ?')
      .bind(invoiceId)
      .first<{ amount_paid_cents: number; total_cents: number }>();
    if (invoice) {
      const paid = Math.max(0, Number(invoice.amount_paid_cents) - amount);
      const balance = Math.max(0, Number(invoice.total_cents) - paid);
      await db
        .prepare('UPDATE invoices SET amount_paid_cents = ?, balance_cents = ?, status = ?, payment_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(paid, balance, balance === 0 ? 'paid' : 'partially_paid', invoiceId)
        .run();
    }
  }
  await audit(db, { actorUserId: actor.id, action: 'refund.stripe_succeeded', entityType: 'payment', entityId: paymentId, detail: refundId });
  return { refundId };
}
