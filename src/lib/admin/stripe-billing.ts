import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import type { D1Database } from './d1.ts';

export interface StripeBillingEnv {
  STRIPE_SECRET_KEY?: string;
  PUBLIC_SITE_URL?: string;
  ADMIN_STRIPE_BILLING_ENABLED?: string;
  ADMIN_STRIPE_REFUNDS_ENABLED?: string;
  ADMIN_STRIPE_SAVED_CARDS_ENABLED?: string;
  ADMIN_STRIPE_OFF_SESSION_ENABLED?: string;
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

async function stripeGet(env: StripeBillingEnv, path: string): Promise<Record<string, unknown>> {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new AdminAuthError(503, 'stripe_not_configured');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new AdminAuthError(502, 'stripe_lookup_failed');
  return data;
}

async function reusableStripeCustomer(
  db: D1Database,
  customerId: string,
  email: string,
  name: string,
  env: StripeBillingEnv,
): Promise<string> {
  const existing = await db
    .prepare('SELECT stripe_customer_id FROM customers WHERE id = ? LIMIT 1')
    .bind(customerId)
    .first<{ stripe_customer_id: string | null }>();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('name', name);
  form.set('metadata[customer_id]', customerId);
  const customer = await stripeRequest(env, 'customers', form, `customer-${customerId}`);
  const id = String(customer.id ?? '');
  if (!id) throw new AdminAuthError(502, 'stripe_customer_failed');
  await db.prepare('UPDATE customers SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id, customerId).run();
  return id;
}

export async function createSavedCardSetupSession(
  db: D1Database,
  actor: AdminActor | null,
  authorizationId: string,
  env: StripeBillingEnv,
): Promise<{ url: string; sessionId: string }> {
  if (env.ADMIN_STRIPE_SAVED_CARDS_ENABLED !== 'true') throw new AdminAuthError(503, 'saved_cards_disabled');
  const auth = await db
    .prepare(
      `SELECT pa.*, c.first_name, c.last_name,
              (SELECT value FROM customer_contacts cc WHERE cc.customer_id = pa.customer_id AND cc.kind = 'email' ORDER BY cc.is_primary DESC LIMIT 1) AS email
       FROM payment_authorizations pa JOIN customers c ON c.id = pa.customer_id
       WHERE pa.id = ? LIMIT 1`,
    )
    .bind(authorizationId)
    .first<Record<string, unknown>>();
  if (!auth) throw new AdminAuthError(404, 'authorization_not_found');
  if (auth.status !== 'pending_card') throw new AdminAuthError(409, 'authorization_not_ready_for_card');
  if (!auth.email) throw new AdminAuthError(400, 'customer_email_required');
  const name = [auth.first_name, auth.last_name].filter(Boolean).join(' ') || 'Customer';
  const stripeCustomerId = await reusableStripeCustomer(db, String(auth.customer_id), String(auth.email), name, env);
  const origin = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
  const form = new URLSearchParams();
  form.set('mode', 'setup');
  form.set('customer', stripeCustomerId);
  form.set('payment_method_types[0]', 'card');
  form.set('success_url', `${origin}/payment-authorization/?status=card_saved&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/payment-authorization/?status=card_cancelled`);
  form.set('metadata[checkout_kind]', 'saved_card_setup');
  form.set('metadata[authorization_id]', authorizationId);
  form.set('metadata[customer_id]', String(auth.customer_id));
  const session = await stripeRequest(env, 'checkout/sessions', form, `saved-card-setup-${authorizationId}`);
  const url = String(session.url ?? '');
  const sessionId = String(session.id ?? '');
  if (!url || !sessionId) throw new AdminAuthError(502, 'stripe_session_failed');
  await db
    .prepare("UPDATE payment_authorizations SET stripe_setup_session_id = ?, setup_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(sessionId, url, authorizationId)
    .run();
  if (actor) {
    await audit(db, { actorUserId: actor.id, action: 'payment_authorization.card_setup_created', entityType: 'payment_authorization', entityId: authorizationId });
  }
  return { url, sessionId };
}

export async function recordSavedCardSetup(
  db: D1Database,
  session: { id?: string; customer?: string; setup_intent?: string; metadata?: Record<string, string> },
  env: StripeBillingEnv,
): Promise<{ saved: boolean }> {
  const metadata = session.metadata ?? {};
  const authorizationId = String(metadata.authorization_id ?? '');
  const customerId = String(metadata.customer_id ?? '');
  if (!authorizationId || !customerId || !session.setup_intent) return { saved: false };
  const intent = await stripeGet(env, `setup_intents/${encodeURIComponent(session.setup_intent)}`);
  const paymentMethodId = String(intent.payment_method ?? '');
  if (!paymentMethodId) return { saved: false };
  const method = await stripeGet(env, `payment_methods/${encodeURIComponent(paymentMethodId)}`);
  const card = (method.card ?? {}) as Record<string, unknown>;
  const consent = await db
    .prepare("SELECT id FROM payment_method_consents WHERE customer_id = ? ORDER BY accepted_at DESC LIMIT 1")
    .bind(customerId)
    .first<{ id: string }>();
  const savedId = `pm_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO saved_payment_methods
       (id, customer_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default, status, consent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)
       ON CONFLICT(stripe_payment_method_id) DO UPDATE SET
         status = 'active', brand = excluded.brand, last4 = excluded.last4,
         exp_month = excluded.exp_month, exp_year = excluded.exp_year, consent_id = excluded.consent_id`,
    )
    .bind(
      savedId,
      customerId,
      String(session.customer ?? ''),
      paymentMethodId,
      String(card.brand ?? ''),
      String(card.last4 ?? ''),
      Number(card.exp_month) || null,
      Number(card.exp_year) || null,
      consent?.id ?? null,
    )
    .run();
  const saved = await db
    .prepare('SELECT id FROM saved_payment_methods WHERE stripe_payment_method_id = ? LIMIT 1')
    .bind(paymentMethodId)
    .first<{ id: string }>();
  await db
    .prepare(
      `UPDATE payment_authorizations SET saved_payment_method_id = ?, status = 'active',
         stripe_setup_session_id = ?, setup_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(saved?.id ?? savedId, String(session.id ?? ''), authorizationId)
    .run();
  await audit(db, { actorUserId: null, action: 'payment_authorization.card_saved', entityType: 'payment_authorization', entityId: authorizationId });
  return { saved: true };
}

export async function chargeInvoiceWithAuthorization(
  db: D1Database,
  actor: AdminActor,
  invoiceId: string,
  authorizationId: string,
  env: StripeBillingEnv,
): Promise<{ paymentId: string; status: string; clientSecret?: string }> {
  if (env.ADMIN_STRIPE_OFF_SESSION_ENABLED !== 'true') throw new AdminAuthError(503, 'off_session_disabled');
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ? LIMIT 1').bind(invoiceId).first<Record<string, unknown>>();
  if (!invoice) throw new AdminAuthError(404, 'invoice_not_found');
  const auth = await db
    .prepare(
      `SELECT pa.*, spm.stripe_customer_id, spm.stripe_payment_method_id
       FROM payment_authorizations pa
       LEFT JOIN saved_payment_methods spm ON spm.id = pa.saved_payment_method_id
       WHERE pa.id = ? AND pa.customer_id = ? AND pa.status = 'active' LIMIT 1`,
    )
    .bind(authorizationId, invoice.customer_id)
    .first<Record<string, unknown>>();
  if (!auth || !auth.stripe_payment_method_id) throw new AdminAuthError(409, 'valid_authorization_not_found');
  const balance = Number(invoice.balance_cents) || 0;
  if (balance <= 0) throw new AdminAuthError(409, 'invoice_paid');
  if (balance > Number(auth.max_amount_cents)) throw new AdminAuthError(409, 'authorization_amount_exceeded');
  if (Number(auth.charge_after_service) !== 1) throw new AdminAuthError(409, 'authorization_not_for_after_service');
  if (invoice.property_id && auth.property_id && invoice.property_id !== auth.property_id) {
    throw new AdminAuthError(409, 'authorization_property_mismatch');
  }
  const idempotencyKey = `stripe-offsession:${invoiceId}:${balance}:${authorizationId}`;
  const previous = await db.prepare('SELECT id FROM payments WHERE idempotency_key = ? LIMIT 1').bind(idempotencyKey).first<{ id: string }>();
  if (previous) return { paymentId: previous.id, status: 'succeeded' };
  const form = new URLSearchParams();
  form.set('amount', String(balance));
  form.set('currency', 'usd');
  form.set('customer', String(auth.stripe_customer_id ?? ''));
  form.set('payment_method', String(auth.stripe_payment_method_id));
  form.set('off_session', 'true');
  form.set('confirm', 'true');
  form.set('metadata[invoice_id]', invoiceId);
  form.set('metadata[authorization_id]', authorizationId);
  let intent: Record<string, unknown>;
  try {
    intent = await stripeRequest(env, 'payment_intents', form, idempotencyKey);
  } catch (error) {
    throw error;
  }
  const status = String(intent.status ?? '');
  if (status !== 'succeeded') {
    return { paymentId: '', status, ...(intent.client_secret ? { clientSecret: String(intent.client_secret) } : {}) };
  }
  const paymentId = `payment_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO payments
       (id, branch_id, customer_id, invoice_id, provider, status, amount_cents, currency,
        stripe_customer_id, stripe_payment_intent_id, idempotency_key, received_at,
        created_by_admin_user_id, metadata_json)
       VALUES (?, ?, ?, ?, 'stripe', 'succeeded', ?, 'USD', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      paymentId,
      invoice.branch_id ?? null,
      invoice.customer_id,
      invoiceId,
      balance,
      String(auth.stripe_customer_id ?? ''),
      String(intent.id ?? ''),
      idempotencyKey,
      new Date().toISOString(),
      actor.id,
      JSON.stringify({ authorization_id: authorizationId, source: 'off_session' }),
    )
    .run();
  const paid = Number(invoice.amount_paid_cents) + balance;
  await db
    .prepare("UPDATE invoices SET amount_paid_cents = ?, balance_cents = 0, status = 'paid', payment_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(paid, invoiceId)
    .run();
  await db
    .prepare("UPDATE payment_authorizations SET status = 'used', used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(authorizationId)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'invoice.off_session_paid', entityType: 'invoice', entityId: invoiceId, detail: authorizationId });
  return { paymentId, status };
}