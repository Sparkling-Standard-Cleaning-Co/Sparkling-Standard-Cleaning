import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  addCustomerNote,
  addProperty,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  updateProperty,
} from '../../../src/lib/admin/crm.ts';

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
    const actor = await requireActor(db, context.request, 'customer.read');
    const url = new URL(context.request.url);
    const id = (url.searchParams.get('id') ?? '').trim();
    if (id) {
      const detail = await getCustomer(db, actor, id);
      if (!detail) return json({ ok: false, error: 'customer_not_found' }, 404);
      return json({ ok: true, ...detail });
    }
    const customers = await listCustomers(db, actor, {
      q: url.searchParams.get('q') ?? '',
      status: url.searchParams.get('status') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 50),
    });
    return json({ ok: true, customers });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'customers_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'customer.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'create') return json({ ok: true, ...(await createCustomer(db, actor, body)) });
    const customerId = String(body.customerId ?? '');
    if (action === 'update') {
      await updateCustomer(db, actor, customerId, body);
      return json({ ok: true });
    }
    if (action === 'add_property') {
      return json({ ok: true, ...(await addProperty(db, actor, customerId, body)) });
    }
    if (action === 'update_property') {
      await updateProperty(db, actor, String(body.propertyId ?? ''), body);
      return json({ ok: true });
    }
    if (action === 'add_note') {
      await addCustomerNote(db, actor, customerId, String(body.body ?? ''), String(body.visibility ?? 'internal'));
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'customer_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
