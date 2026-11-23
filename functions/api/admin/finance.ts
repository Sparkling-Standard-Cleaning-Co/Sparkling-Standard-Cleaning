import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf, requireStepUp } from '../../../src/lib/admin/operations.ts';
import { verifyPassword } from '../../../src/lib/admin/auth.ts';
import {
  applyCreditToInvoice,
  countInvoices,
  createCredit,
  createInvoice,
  financeSummary,
  getInvoice,
  invoicePageBounds,
  listCustomerCredits,
  listInvoices,
  recordPayment,
  recordRefund,
  updateInvoiceStatus,
} from '../../../src/lib/admin/billing.ts';
import {
  createCustomerBillingPortalSession,
  createInvoicePaymentLink,
  createInvoicePaymentPageLink,
  refundStripePayment,
  tipLinkForInvoice,
  type StripeBillingEnv,
} from '../../../src/lib/admin/stripe-billing.ts';
import { assignTipParticipants } from '../../../src/lib/tips/service.ts';
import { buildAdminInvoice } from '../../../src/lib/invoicing/admin-invoice.ts';
import { buildInvoicePdf } from '../../../src/lib/invoicing/pdf.ts';
import { buildInvoiceEmail, sendInvoiceEmail, type InvoiceEmailEnv } from '../../../src/lib/invoicing/invoice-email.ts';
import { deliverInvoiceReceipt } from '../../../src/lib/invoicing/invoice-receipt.ts';
import { invoiceReviewInvitation, reviewContextForInvoice } from '../../../src/lib/reviews/service.ts';
import { DEPARTMENT_ADDRESSES, readCommunicationSettings } from '../../../src/lib/admin/communications.ts';

interface Env extends AdminDbEnv, StripeBillingEnv, InvoiceEmailEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'finance.read');
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id') ?? '';
    if (id) {
      const invoice = await getInvoice(db, actor, id);
      if (!invoice) return json({ ok: false, error: 'invoice_not_found' }, 404);
      return json({ ok: true, ...invoice });
    }
    if (url.searchParams.get('summary') === '1') {
      return json({ ok: true, summary: await financeSummary(db, actor) });
    }
    if (url.searchParams.get('view') === 'credits') {
      const customerId = url.searchParams.get('customerId') ?? '';
      if (!customerId) return json({ ok: false, error: 'customer_required' }, 400);
      return json({ ok: true, credits: await listCustomerCredits(db, actor, customerId) });
    }
    const input = {
      status: url.searchParams.get('status') ?? '',
      q: url.searchParams.get('q') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 25),
      offset: Number(url.searchParams.get('offset') ?? 0),
      sort: url.searchParams.get('sort') ?? 'created_at',
    };
    const [invoices, total, summary] = await Promise.all([
      listInvoices(db, actor, input),
      countInvoices(db, actor, input),
      financeSummary(db, actor),
    ]);
    const bounds = invoicePageBounds(input);
    return json({ ok: true, invoices, total, limit: bounds.limit, offset: bounds.offset, sort: bounds.sort, summary });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'finance_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'finance.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (
      action !== 'preview_invoice_email' &&
      ['create_invoice', 'invoice_status', 'record_payment', 'record_refund', 'create_credit', 'apply_credit', 'payment_link', 'billing_portal', 'resend_invoice_receipt', 'email_invoice', 'stripe_refund'].includes(action)
    ) {
      requireStepUp(actor);
    }
    if (action === 'create_invoice') return json({ ok: true, ...(await createInvoice(db, actor, body)) });
    if (action === 'invoice_status') {
      await updateInvoiceStatus(db, actor, String(body.invoiceId ?? ''), String(body.status ?? ''));
      return json({ ok: true });
    }
    if (action === 'record_payment') return json({ ok: true, ...(await recordPayment(db, actor, body)) });
    if (action === 'record_refund') return json({ ok: true, ...(await recordRefund(db, actor, body)) });
    if (action === 'create_credit') return json({ ok: true, ...(await createCredit(db, actor, body)) });
    if (action === 'apply_credit') return json({ ok: true, ...(await applyCreditToInvoice(db, actor, body)) });
    if (action === 'payment_link') {
      return json({ ok: true, ...(await createInvoicePaymentLink(db, actor, String(body.invoiceId ?? ''), context.env)) });
    }
    if (action === 'payment_page_link') {
      return json({ ok: true, ...(await createInvoicePaymentPageLink(db, actor, String(body.invoiceId ?? ''), context.env, 'invoice')) });
    }
    if (action === 'tip_link') {
      const invoiceId = String(body.invoiceId ?? '');
      const invoice = await getInvoice(db, actor, invoiceId);
      if (!invoice) return json({ ok: false, error: 'invoice_not_found' }, 404);
      return json({ ok: true, ...(await tipLinkForInvoice(db, invoiceId, context.env)) });
    }
    if (action === 'allocate_tip') {
      const paymentId = String(body.paymentId ?? '');
      const teamMemberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.filter((value): value is string => typeof value === 'string')
        : [];
      return json({ ok: true, ...(await assignTipParticipants(db, actor, paymentId, teamMemberIds)) });
    }
    if (action === 'billing_portal') {
      return json({
        ok: true,
        ...(await createCustomerBillingPortalSession(db, actor, String(body.customerId ?? ''), context.env)),
      });
    }
    if (action === 'resend_invoice_receipt') {
      const invoiceId = String(body.invoiceId ?? '');
      const result = await getInvoice(db, actor, invoiceId);
      if (!result) return json({ ok: false, error: 'invoice_not_found' }, 404);
      const invoice = result.invoice as Record<string, unknown>;
      if (String(invoice.status) !== 'paid') {
        return json({ ok: false, error: 'invoice_not_paid' }, 409);
      }
      const receipt = await deliverInvoiceReceipt(db, context.env, {
        invoiceId,
        actorUserId: actor.id,
        force: true,
      });
      return json({ ok: receipt.status === 'sent', receipt: receipt.status });
    }
    if (action === 'preview_invoice_email') {
      const invoiceId = String(body.invoiceId ?? '');
      const result = await getInvoice(db, actor, invoiceId);
      if (!result) return json({ ok: false, error: 'invoice_not_found' }, 404);
      const invoice = result.invoice as Record<string, unknown>;
      const review = invoiceReviewInvitation(await reviewContextForInvoice(db, invoiceId).catch(() => null));
      const document = buildAdminInvoice({
        invoice,
        lines: (result.lines as Array<Record<string, unknown>>) ?? [],
        ...(review ? { review } : {}),
      });
      const email = buildInvoiceEmail(document.data, document.totals);
      return json({
        ok: true,
        subject: email.subject,
        html: email.html,
        text: email.text,
        hasPaymentLink: Boolean(invoice.payment_url),
      });
    }
    if (action === 'email_invoice') {
      const invoiceId = String(body.invoiceId ?? '');
      let result = await getInvoice(db, actor, invoiceId);
      if (!result) return json({ ok: false, error: 'invoice_not_found' }, 404);
      let invoice = result.invoice as Record<string, unknown>;
      if (!['open', 'partially_paid', 'overdue'].includes(String(invoice.status))) {
        return json({ ok: false, error: 'invoice_not_sendable' }, 409);
      }
      if (Number(invoice.balance_cents) <= 0) return json({ ok: false, error: 'invoice_paid' }, 409);
      const to = String(invoice.customer_email ?? '').trim();
      if (!to) return json({ ok: false, error: 'customer_email_missing' }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return json({ ok: false, error: 'customer_email_invalid' }, 400);
      }
      if (!context.env.RESEND_API_KEY?.trim()) {
        return json({ ok: false, error: 'email_not_configured' }, 503);
      }
      if (body.includePaymentLink === true) {
        try {
          await createInvoicePaymentPageLink(db, actor, invoiceId, context.env, 'invoice');
          result = await getInvoice(db, actor, invoiceId);
          if (!result) return json({ ok: false, error: 'invoice_not_found' }, 404);
          invoice = result.invoice as Record<string, unknown>;
        } catch (error) {
          return json(
            { ok: false, error: error instanceof AdminAuthError ? error.code : 'payment_link_failed' },
            error instanceof AdminAuthError ? error.status : 502,
          );
        }
      }
      const review = invoiceReviewInvitation(await reviewContextForInvoice(db, invoiceId).catch(() => null));
      const document = buildAdminInvoice({
        invoice,
        lines: (result.lines as Array<Record<string, unknown>>) ?? [],
        ...(review ? { review } : {}),
      });
      const pdf = buildInvoicePdf(document.data, document.totals);
      const communication = await readCommunicationSettings(db).catch(() => null);
      const invoiceReplyTo = communication
        ? DEPARTMENT_ADDRESSES[communication.settings.replyTo.invoices]
        : undefined;
      const outcome = await sendInvoiceEmail({
        to,
        data: document.data,
        totals: document.totals,
        pdf,
        env: {
          ...context.env,
          ...(invoiceReplyTo ? { RESEND_BILLING_REPLY_TO: invoiceReplyTo } : {}),
        },
        idempotencyKey:
          String(body.idempotencyKey ?? '').trim() || `invoice-email-${invoiceId}-${crypto.randomUUID()}`,
      });
      await audit(db, {
        actorUserId: actor.id,
        action: outcome.status === 'sent' ? 'invoice.emailed' : 'invoice.email_failed',
        entityType: 'invoice',
        entityId: invoiceId,
        detail: outcome.providerStatus ? `provider_${outcome.providerStatus}` : outcome.status,
      }).catch(() => undefined);
      if (outcome.status === 'sent') return json({ ok: true, status: 'sent' });
      return json(
        { ok: false, error: outcome.status === 'failed' ? 'invoice_email_failed' : 'email_not_configured' },
        outcome.status === 'failed' ? 502 : 503,
      );
    }
    if (action === 'stripe_refund') {
      const stored = await db.prepare('SELECT password_hash FROM admin_users WHERE id = ? LIMIT 1').bind(actor.id).first<{ password_hash: string }>();
      if (!stored || !(await verifyPassword(String(body.password ?? ''), stored.password_hash))) {
        return json({ ok: false, error: 'reauth_failed' }, 401);
      }
      return json({
        ok: true,
        ...(await refundStripePayment(
          db,
          actor,
          String(body.paymentId ?? ''),
          Number(body.amountCents) || 0,
          context.env,
          String(body.idempotencyKey ?? ''),
        )),
      });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'finance_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
