import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  createCredit,
  createInvoice,
  financeSummary,
  getInvoice,
  listInvoices,
  recordPayment,
  recordRefund,
  updateInvoiceStatus,
} from '../../../src/lib/admin/billing.ts';

interface Env extends AdminDbEnv {}

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
    return json({
      ok: true,
      invoices: await listInvoices(db, actor, {
        status: url.searchParams.get('status') ?? '',
        q: url.searchParams.get('q') ?? '',
      }),
      summary: await financeSummary(db, actor),
    });
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
    if (action === 'create_invoice') return json({ ok: true, ...(await createInvoice(db, actor, body)) });
    if (action === 'invoice_status') {
      await updateInvoiceStatus(db, actor, String(body.invoiceId ?? ''), String(body.status ?? ''));
      return json({ ok: true });
    }
    if (action === 'record_payment') return json({ ok: true, ...(await recordPayment(db, actor, body)) });
    if (action === 'record_refund') return json({ ok: true, ...(await recordRefund(db, actor, body)) });
    if (action === 'create_credit') return json({ ok: true, ...(await createCredit(db, actor, body)) });
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'finance_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
