import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { listLeads, retryLeadNotification, updateLead } from '../../../src/lib/admin/crm.ts';

interface Env extends AdminDbEnv {
  WEB3FORMS_ACCESS_KEY?: string;
  WEB3FORMS_ENDPOINT?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function payload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'lead.read');
    const url = new URL(context.request.url);
    const leads = await listLeads(db, actor, {
      status: url.searchParams.get('status') ?? '',
      q: url.searchParams.get('q') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 100),
    });
    return json({
      ok: true,
      leads: leads.map((lead) => ({ ...lead, payload: payload(lead.payload_json) })),
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'leads_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'lead.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const leadId = String(body.leadId ?? '');
    if (action === 'update') {
      await updateLead(db, actor, leadId, {
        status: String(body.status ?? ''),
        note: String(body.note ?? ''),
      });
      return json({ ok: true });
    }
    if (action === 'retry_notification') {
      const result = await retryLeadNotification(db, actor, leadId, {
        ...(context.env.WEB3FORMS_ACCESS_KEY ? { WEB3FORMS_ACCESS_KEY: context.env.WEB3FORMS_ACCESS_KEY } : {}),
        ...(context.env.WEB3FORMS_ENDPOINT ? { WEB3FORMS_ENDPOINT: context.env.WEB3FORMS_ENDPOINT } : {}),
      });
      return json({ ok: true, ...result });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'lead_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
