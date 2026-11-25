// Signed service change orders. The original agreement and primary invoice are
// preserved; the amendment uses the existing approved additional-service
// template and creates an explicit supplemental invoice after execution.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  requireActor,
  requireCsrf,
  requireStepUp,
  type AdminActor,
} from '../../../src/lib/admin/operations.ts';
import { createInvoice } from '../../../src/lib/admin/billing.ts';
import {
  approveChangeOrder,
  changeOrderInvoiceInput,
  createChangeOrder,
  declineChangeOrder,
  getChangeOrder,
  linkChangeOrderInvoice,
  listChangeOrders,
  sendChangeOrder,
} from '../../../src/lib/change-orders/service.ts';
import { sendSigningEmail } from '../../../src/lib/documents/service.ts';

interface Env extends AdminDbEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function assertBranch(actor: AdminActor, branchId: unknown): void {
  if (actor.role === 'owner') return;
  if (!actor.branchId || String(branchId ?? '') !== actor.branchId) {
    throw new AdminAuthError(403, 'forbidden');
  }
}

async function customerEmail(db: NonNullable<ReturnType<typeof adminDb>>, customerId: string): Promise<string> {
  const row = await db
    .prepare(
      `SELECT value FROM customer_contacts
       WHERE customer_id = ? AND kind = 'email'
       ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
    )
    .bind(customerId)
    .first<{ value: string }>();
  return text(row?.value, 200).toLowerCase();
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.read');
    const url = new URL(context.request.url);
    const id = text(url.searchParams.get('id'), 120);
    if (id) {
      const changeOrder = await getChangeOrder(db, id);
      if (!changeOrder) return json({ ok: false, error: 'change_order_not_found' }, 404);
      assertBranch(actor, changeOrder.branch_id);
      return json({ ok: true, changeOrder });
    }
    const appointmentId = text(url.searchParams.get('appointmentId'), 120);
    const customerId = text(url.searchParams.get('customerId'), 100);
    const changeOrders = await listChangeOrders(db, {
      ...(appointmentId ? { appointmentId } : {}),
      ...(customerId ? { customerId } : {}),
    });
    return json({ ok: true, changeOrders });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'change_orders_failed' },
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
    const action = text(body.action, 60);
    if (action === 'create') {
      requireStepUp(actor);
      const changeOrder = await createChangeOrder(db, actor.id, body);
      assertBranch(actor, changeOrder.branch_id);
      return json({ ok: true, changeOrder });
    }
    const id = text(body.id, 120);
    if (!id) return json({ ok: false, error: 'change_order_required' }, 400);
    const existing = await getChangeOrder(db, id);
    if (!existing) return json({ ok: false, error: 'change_order_not_found' }, 404);
    assertBranch(actor, existing.branch_id);
    if (action === 'approve') {
      requireStepUp(actor);
      return json({ ok: true, changeOrder: await approveChangeOrder(db, actor.id, id) });
    }
    if (action === 'decline') {
      await declineChangeOrder(db, actor.id, id, text(body.reason, 500));
      return json({ ok: true, changeOrder: await getChangeOrder(db, id) });
    }
    if (action === 'send') {
      const sent = await sendChangeOrder(db, actor.id, id);
      const recipient = text(body.email, 200) || (await customerEmail(db, String(existing.customer_id)));
      const emailSent = recipient
        ? await sendSigningEmail(
            {
              ...(context.env.RESEND_API_KEY ? { RESEND_API_KEY: context.env.RESEND_API_KEY } : {}),
              ...(context.env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: context.env.RESEND_FROM_EMAIL } : {}),
              ...(context.env.PUBLIC_SITE_URL ? { PUBLIC_SITE_URL: context.env.PUBLIC_SITE_URL } : {}),
            },
            recipient,
            sent.token,
            sent.bundleName,
            `change-order-${id}-${sent.token.slice(0, 12)}`,
          ).catch(() => false)
        : false;
      return json({
        ok: true,
        ...sent,
        recipient,
        emailSent,
        changeOrder: await getChangeOrder(db, id),
      });
    }
    if (action === 'create_invoice') {
      requireStepUp(actor);
      const input = await changeOrderInvoiceInput(db, id);
      const invoice = await createInvoice(db, actor, input);
      await linkChangeOrderInvoice(db, actor.id, id, invoice.id);
      return json({
        ok: true,
        invoice,
        changeOrder: await getChangeOrder(db, id),
      });
    }
    return json({ ok: false, error: 'change_order_action_invalid' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'change_order_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
