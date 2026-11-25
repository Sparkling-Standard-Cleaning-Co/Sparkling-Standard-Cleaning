import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import type { D1Database } from './d1.ts';
import { beginRefund, completeRefund, failRefund } from './refunds.ts';
import { createInvoicePayUrl, verifyInvoicePayToken } from '../tips/token.ts';
import { normalizeTipCents, tipsEnabled } from '../../config/tips.ts';

export interface StripeBillingEnv {
  STRIPE_SECRET_KEY?: string;
  PUBLIC_SITE_URL?: string;
  ADMIN_STRIPE_BILLING_ENABLED?: string;
  ADMIN_STRIPE_REFUNDS_ENABLED?: string;
  ADMIN_STRIPE_SAVED_CARDS_ENABLED?: string;
  ADMIN_STRIPE_OFF_SESSION_ENABLED?: string;
  ADMIN_STRIPE_PORTAL_ENABLED?: string;
  PORTAL_BILLING_ENABLED?: string;
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID?: string;
  TIPS_LINK_SECRET?: string;
  TIPS_ENABLED?: string;
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

export async function createCustomerBillingPortalSession(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  env: StripeBillingEnv,
): Promise<{ url: string; sessionId: string }> {
  if (env.ADMIN_STRIPE_PORTAL_ENABLED !== 'true') {
    throw new AdminAuthError(503, 'stripe_billing_portal_disabled');
  }
  const customer = await db
    .prepare("SELECT id, primary_branch_id, stripe_customer_id FROM customers WHERE id = ? AND source <> 'financial_system' LIMIT 1")
    .bind(customerId)
    .first<{ id: string; primary_branch_id: string | null; stripe_customer_id: string | null }>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  if (agentScope(actor) && customer.primary_branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'forbidden');
  }
  if (!customer.stripe_customer_id) {
    throw new AdminAuthError(409, 'stripe_customer_required');
  }
  const origin = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
  const form = new URLSearchParams();
  form.set('customer', customer.stripe_customer_id);
  form.set('return_url', `${origin}/admin/`);
  const configuration = env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim();
  if (configuration) form.set('configuration', configuration);
  const session = await stripeRequest(
    env,
    'billing_portal/sessions',
    form,
    `billing-portal-${customerId}-${Date.now()}`,
  );
  const url = String(session.url ?? '');
  const sessionId = String(session.id ?? '');
  if (!url || !sessionId) throw new AdminAuthError(502, 'stripe_portal_session_failed');
  await audit(db, {
    actorUserId: actor.id,
    action: 'customer.billing_portal_opened',
    entityType: 'customer',
    entityId: customerId,
  });
  return { url, sessionId };
}

export async function createPortalBillingSession(
  db: D1Database,
  customerId: string,
  verifiedEmail: string,
  env: StripeBillingEnv,
): Promise<{ url: string; sessionId: string }> {
  if (env.PORTAL_BILLING_ENABLED !== 'true') {
    throw new AdminAuthError(503, 'portal_billing_disabled');
  }
  const customer = await db
    .prepare("SELECT id, first_name, last_name, company_name, stripe_customer_id FROM customers WHERE id = ? AND status = 'active' AND source <> 'financial_system' LIMIT 1")
    .bind(customerId)
    .first<{
      id: string;
      first_name: string;
      last_name: string;
      company_name: string;
      stripe_customer_id: string | null;
    }>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || verifiedEmail;
  const stripeCustomerId = customer.stripe_customer_id || await reusableStripeCustomer(
    db,
    customerId,
    verifiedEmail,
    name,
    env,
  );
  const origin = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
  const form = new URLSearchParams();
  form.set('customer', stripeCustomerId);
  form.set('return_url', `${origin}/portal/`);
  const configuration = env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim();
  if (configuration) form.set('configuration', configuration);
  const session = await stripeRequest(
    env,
    'billing_portal/sessions',
    form,
    `portal-billing-${customerId}-${Date.now()}`,
  );
  const url = String(session.url ?? '');
  const sessionId = String(session.id ?? '');
  if (!url || !sessionId) throw new AdminAuthError(502, 'stripe_portal_session_failed');
  await audit(db, {
    actorUserId: null,
    action: 'customer.portal_billing_session_created',
    entityType: 'customer',
    entityId: customerId,
  });
  return { url, sessionId };
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
    const existingSessionId = String(result.stripe_checkout_session_id ?? '');
    if (!existingSessionId) throw new AdminAuthError(502, 'invoice_session_unverified');
    const session = await stripeGet(env, `checkout/sessions/${encodeURIComponent(existingSessionId)}`).catch(
      () => null,
    );
    if (!session) throw new AdminAuthError(502, 'invoice_session_unverified');
    const status = String(session.status ?? '');
    const sessionAmount = Number(session.amount_total);
    if (status === 'open' && sessionAmount === balance) {
      return { url: String(result.payment_url), sessionId: existingSessionId };
    }
    if (status === 'complete') throw new AdminAuthError(409, 'invoice_payment_processing');
    if (status === 'open') {
      const expired = await expireInvoiceCheckoutSession(env, existingSessionId);
      if (!expired) throw new AdminAuthError(502, 'invoice_session_unverified');
    } else if (status !== 'expired') {
      throw new AdminAuthError(502, 'invoice_session_unverified');
    }
    await db
      .prepare(
        'UPDATE invoices SET payment_url = NULL, stripe_checkout_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .bind(invoiceId)
      .run();
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

async function invoiceForCheckout(
  db: D1Database,
  invoiceId: string,
): Promise<Record<string, unknown>> {
  const invoice = await db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, c.company_name,
              a.status AS appointment_status
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN appointments a ON a.id = i.appointment_id
       WHERE i.id = ? LIMIT 1`,
    )
    .bind(invoiceId)
    .first<Record<string, unknown>>();
  if (!invoice) throw new AdminAuthError(404, 'invoice_not_found');
  return invoice;
}

function invoiceCheckoutMode(
  invoice: Record<string, unknown>,
  mode: 'invoice' | 'tip',
  balance: number,
): 'invoice' | 'tip' {
  if (mode === 'tip') {
    if (balance > 0) throw new AdminAuthError(409, 'invoice_balance_outstanding');
    if (String(invoice.status) !== 'paid') throw new AdminAuthError(409, 'invoice_payment_required');
    if (
      invoice.appointment_id &&
      String(invoice.appointment_status ?? '') !== 'completed'
    ) {
      throw new AdminAuthError(409, 'service_not_completed');
    }
    return 'tip';
  }
  if (balance > 0) return 'invoice';
  if (String(invoice.status) === 'paid') {
    if (
      invoice.appointment_id &&
      String(invoice.appointment_status ?? '') !== 'completed'
    ) {
      throw new AdminAuthError(409, 'service_not_completed');
    }
    return 'tip';
  }
  throw new AdminAuthError(409, 'invoice_not_payable');
}

export interface InvoiceCheckoutResult {
  url: string;
  sessionId: string;
  serviceCents: number;
  tipCents: number;
  totalCents: number;
  mode: 'invoice' | 'tip';
}

/**
 * Creates (or safely reuses) the Stripe Checkout session for an invoice. The
 * service amount comes only from the invoice balance; the gratuity is a
 * separate, validated line item. Tip-only sessions never include service.
 */
export async function createInvoiceCheckoutSession(
  db: D1Database,
  invoiceId: string,
  env: StripeBillingEnv,
  options: { tipCents?: unknown; mode?: 'invoice' | 'tip'; token?: string } = {},
): Promise<InvoiceCheckoutResult> {
  if (env.ADMIN_STRIPE_BILLING_ENABLED !== 'true') {
    throw new AdminAuthError(503, 'stripe_billing_disabled');
  }
  if (!tipsEnabled(env)) throw new AdminAuthError(503, 'tips_disabled');
  const invoice = await invoiceForCheckout(db, invoiceId);
  if (String(invoice.status) === 'void') throw new AdminAuthError(409, 'invoice_void');
  const balance = Math.max(0, Number(invoice.balance_cents) || 0);
  const mode = invoiceCheckoutMode(invoice, options.mode === 'tip' ? 'tip' : 'invoice', balance);
  const serviceCents = mode === 'tip' ? 0 : balance;
  const tipCents = normalizeTipCents(options.tipCents);
  if (tipCents === 0 && serviceCents === 0) {
    throw new AdminAuthError(400, 'tip_or_balance_required');
  }
  const total = serviceCents + tipCents;
  const existingSessionId = String(invoice.stripe_checkout_session_id ?? '');
  if (existingSessionId) {
    const existing = await stripeGet(env, `checkout/sessions/${encodeURIComponent(existingSessionId)}`).catch(
      () => null,
    );
    if (existing) {
      const status = String(existing.status ?? '');
      const metadata = (existing.metadata ?? {}) as Record<string, string>;
      const existingTotal = Number(existing.amount_total);
      const existingTip = Number(metadata.tip_cents ?? -1);
      if (
        status === 'open' &&
        existingTotal === total &&
        existingTip === tipCents &&
        metadata.checkout_kind === (serviceCents > 0 ? 'invoice_payment' : 'invoice_tip')
      ) {
        const existingUrl = String(existing.url ?? '');
        if (!existingUrl) throw new AdminAuthError(502, 'invoice_session_unverified');
        return {
          url: existingUrl,
          sessionId: existingSessionId,
          serviceCents,
          tipCents,
          totalCents: total,
          mode,
        };
      }
      if (status === 'complete') throw new AdminAuthError(409, 'invoice_payment_processing');
      if (status === 'open') {
        const expired = await expireInvoiceCheckoutSession(env, existingSessionId);
        if (!expired) throw new AdminAuthError(502, 'invoice_session_unverified');
      }
      await db
        .prepare('UPDATE invoices SET stripe_checkout_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(invoiceId)
        .run();
    } else {
      await db
        .prepare('UPDATE invoices SET stripe_checkout_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(invoiceId)
        .run();
    }
  }
  const origin = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
  const stripeCustomerId = await customerForInvoice(db, invoice, env);
  const redirect = options.token
    ? `${origin}/invoice-pay/?token=${encodeURIComponent(options.token)}`
    : `${origin}/invoice-payment/`;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('customer', stripeCustomerId);
  form.set('client_reference_id', invoiceId);
  form.set('success_url', `${redirect}${redirect.includes('?') ? '&' : '?'}status=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${redirect}${redirect.includes('?') ? '&' : '?'}status=cancelled`);
  let index = 0;
  if (serviceCents > 0) {
    form.set(`line_items[${index}][quantity]`, '1');
    form.set(`line_items[${index}][price_data][currency]`, 'usd');
    form.set(`line_items[${index}][price_data][unit_amount]`, String(serviceCents));
    form.set(`line_items[${index}][price_data][product_data][name]`, `Cleaning service — invoice ${String(invoice.number ?? '')}`);
    index += 1;
  }
  if (tipCents > 0) {
    form.set(`line_items[${index}][quantity]`, '1');
    form.set(`line_items[${index}][price_data][currency]`, 'usd');
    form.set(`line_items[${index}][price_data][unit_amount]`, String(tipCents));
    form.set(`line_items[${index}][price_data][product_data][name]`, 'Optional gratuity for your cleaning team');
    index += 1;
  }
  const checkoutKind = serviceCents > 0 ? 'invoice_payment' : 'invoice_tip';
  form.set('metadata[checkout_kind]', checkoutKind);
  form.set('metadata[invoice_id]', invoiceId);
  form.set('metadata[customer_id]', String(invoice.customer_id ?? ''));
  form.set('metadata[service_amount_cents]', String(serviceCents));
  form.set('metadata[tip_cents]', String(tipCents));
  form.set('payment_intent_data[metadata][invoice_id]', invoiceId);
  form.set('payment_intent_data[metadata][checkout_kind]', checkoutKind);
  form.set('payment_intent_data[metadata][tip_cents]', String(tipCents));
  const session = await stripeRequest(
    env,
    'checkout/sessions',
    form,
    `invoice-checkout-${invoiceId}-${serviceCents}-${tipCents}`,
  );
  const url = String(session.url ?? '');
  const sessionId = String(session.id ?? '');
  if (!url || !sessionId) throw new AdminAuthError(502, 'stripe_session_failed');
  await db
    .prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(sessionId, invoiceId)
    .run();
  await audit(db, {
    actorUserId: null,
    action: 'invoice.tip_checkout_created',
    entityType: 'invoice',
    entityId: invoiceId,
    detail: `${checkoutKind}:${serviceCents}:${tipCents}`,
  });
  return { url, sessionId, serviceCents, tipCents, totalCents: total, mode };
}

export async function createInvoicePaymentPageLink(
  db: D1Database,
  actor: AdminActor,
  invoiceId: string,
  env: StripeBillingEnv,
  mode: 'invoice' | 'tip' = 'invoice',
): Promise<{ url: string; sessionId: '' }> {
  if (env.ADMIN_STRIPE_BILLING_ENABLED !== 'true') {
    throw new AdminAuthError(503, 'stripe_billing_disabled');
  }
  if (!tipsEnabled(env)) throw new AdminAuthError(503, 'tips_disabled');
  const invoice = await invoiceForCheckout(db, invoiceId);
  if (agentScope(actor) && invoice.branch_id !== actor.branchId) throw new AdminAuthError(403, 'forbidden');
  const balance = Math.max(0, Number(invoice.balance_cents) || 0);
  if (mode === 'invoice' && !['open', 'partially_paid', 'overdue'].includes(String(invoice.status))) {
    throw new AdminAuthError(409, 'invoice_not_payable');
  }
  if (mode === 'invoice' && balance <= 0) throw new AdminAuthError(409, 'invoice_paid');
  if (mode === 'tip') {
    invoiceCheckoutMode(invoice, 'tip', balance);
  }
  const url = await createInvoicePayUrl(env, invoiceId, mode);
  await db
    .prepare('UPDATE invoices SET payment_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(url, invoiceId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'invoice.payment_page_link_created',
    entityType: 'invoice',
    entityId: invoiceId,
    detail: mode,
  });
  return { url, sessionId: '' };
}

export async function tipLinkForInvoice(
  db: D1Database,
  invoiceId: string,
  env: StripeBillingEnv,
): Promise<{ url: string; expiresAt: string }> {
  if (!tipsEnabled(env)) throw new AdminAuthError(503, 'tips_disabled');
  const invoice = await invoiceForCheckout(db, invoiceId);
  invoiceCheckoutMode(invoice, 'tip', Math.max(0, Number(invoice.balance_cents) || 0));
  const token = await createInvoicePayUrl(env, invoiceId, 'tip');
  const verified = await verifyInvoicePayToken(env, new URL(token).searchParams.get('token') ?? '');
  return { url: token, expiresAt: verified?.expiresAt ?? '' };
}

export async function refundStripePayment(
  db: D1Database,
  actor: AdminActor,
  paymentId: string,
  amountCents: number,
  env: StripeBillingEnv,
  idempotencyKey?: string,
): Promise<{ refundId: string; status: 'succeeded' | 'pending' }> {
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
  if (amount <= 0) throw new AdminAuthError(400, 'refund_amount_invalid');
  const requestId = idempotencyKey?.trim() || `stripe-refund-${crypto.randomUUID()}`;
  const local = await beginRefund(db, actor, {
    paymentId,
    amountCents: amount,
    reason: 'admin stripe refund',
    idempotencyKey: requestId,
    status: 'pending',
  });
  if (local.status === 'succeeded') {
    const stored = await db
      .prepare('SELECT stripe_refund_id FROM refunds WHERE id = ? LIMIT 1')
      .bind(local.id)
      .first<{ stripe_refund_id: string | null }>();
    return { refundId: stored?.stripe_refund_id || local.id, status: 'succeeded' };
  }
  if (local.status === 'failed') throw new AdminAuthError(409, 'refund_failed');

  const form = new URLSearchParams();
  form.set('payment_intent', intent);
  form.set('amount', String(amount));
  const refund = await stripeRequest(env, 'refunds', form, `invoice-refund-${requestId}`);
  const stripeRefundId = String(refund.id ?? '');
  if (!stripeRefundId) throw new AdminAuthError(502, 'stripe_refund_failed');
  const stripeStatus = String(refund.status ?? 'succeeded').toLowerCase();
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
    await failRefund(db, actor, local.id, `stripe:${stripeStatus}`);
    throw new AdminAuthError(502, 'refund_failed');
  }
  if (stripeStatus === 'pending') {
    return { refundId: local.id, status: 'pending' };
  }
  await completeRefund(db, actor, local.id, stripeRefundId);
  await audit(db, {
    actorUserId: actor.id,
    action: 'refund.stripe_succeeded',
    entityType: 'payment',
    entityId: paymentId,
    detail: stripeRefundId,
  });
  return { refundId: stripeRefundId, status: 'succeeded' };
}

async function expireInvoiceCheckoutSession(env: StripeBillingEnv, sessionId: string): Promise<boolean> {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key || !sessionId) return false;
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
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