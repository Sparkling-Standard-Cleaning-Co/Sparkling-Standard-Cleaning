import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  archiveLead,
  countLeads,
  deleteDisposableLead,
  leadPageBounds,
  listLeads,
  markLeadConverted,
  markLeadDuplicate,
  markLeadTest,
  previewSuspectedTestLeads,
  restoreLead,
  retryLeadNotification,
  updateLead,
} from '../../../src/lib/admin/crm.ts';
import { summarizeLeadResults } from '../../../src/lib/admin/lead-classification.ts';

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
    if (url.searchParams.get('view') === 'test_preview') {
      return json({ ok: true, suspects: await previewSuspectedTestLeads(db, actor) });
    }
    const id = (url.searchParams.get('id') ?? '').trim();
    if (id) {
      const scope = actor.role === 'owner' ? '' : actor.branchId ? ' AND l.branch_id = ?' : ' AND 1 = 0';
      const bind = actor.role === 'owner' ? [] : actor.branchId ? [actor.branchId] : [];
      const lead = await db
        .prepare(
          `SELECT l.*, c.first_name, c.last_name, c.company_name, c.id AS linked_customer_id,
                  p.line1, p.city, p.state, p.postal_code
           FROM leads l
           LEFT JOIN customers c ON c.id = l.customer_id
           LEFT JOIN properties p ON p.id = l.property_id
           WHERE l.id = ?${scope} LIMIT 1`,
        )
        .bind(id, ...bind)
        .first<Record<string, unknown>>();
      if (!lead) return json({ ok: false, error: 'lead_not_found' }, 404);
      const auditRows = await db
        .prepare(
          `SELECT action, success, detail_json, created_at FROM admin_audit
           WHERE entity_id = ? ORDER BY created_at DESC LIMIT 30`,
        )
        .bind(id)
        .all();
      return json({
        ok: true,
        lead: { ...lead, payload: payload(lead.payload_json) },
        audit: auditRows.results ?? [],
      });
    }
    const input = {
      status: url.searchParams.get('status') ?? '',
      q: url.searchParams.get('q') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 25),
      offset: Number(url.searchParams.get('offset') ?? 0),
      sort: url.searchParams.get('sort') ?? 'created_at',
    };
    const [leads, total] = await Promise.all([
      listLeads(db, actor, input),
      countLeads(db, actor, input),
    ]);
    const bounds = leadPageBounds(input);
    return json({
      ok: true,
      leads: leads.map((lead) => ({ ...lead, payload: payload(lead.payload_json) })),
      total,
      limit: bounds.limit,
      offset: bounds.offset,
      sort: bounds.sort,
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
    if (action === 'archive') {
      await archiveLead(db, actor, leadId);
      return json({ ok: true });
    }
    if (action === 'restore') {
      await restoreLead(db, actor, leadId);
      return json({ ok: true });
    }
    if (action === 'delete') {
      await deleteDisposableLead(db, actor, leadId);
      return json({ ok: true });
    }
    if (action === 'mark_test' || action === 'unmark_test') {
      await markLeadTest(db, actor, leadId, action === 'mark_test');
      return json({ ok: true });
    }
    if (action === 'mark_duplicate' || action === 'unmark_duplicate') {
      await markLeadDuplicate(db, actor, leadId, action === 'mark_duplicate', String(body.duplicateOf ?? ''));
      return json({ ok: true });
    }
    if (action === 'mark_converted') {
      await markLeadConverted(db, actor, leadId);
      return json({ ok: true });
    }
    if (action === 'bulk') {
      const operation = String(body.operation ?? '');
      const ids = Array.isArray(body.leadIds)
        ? body.leadIds.filter((value): value is string => typeof value === 'string').slice(0, 200)
        : [];
      const operations = ['archive', 'restore', 'delete', 'mark_test', 'unmark_test', 'mark_duplicate', 'unmark_duplicate', 'mark_converted'];
      if (!operations.includes(operation)) {
        return json({ ok: false, error: 'bulk_operation_invalid' }, 400);
      }
      if (ids.length === 0) return json({ ok: false, error: 'bulk_selection_required' }, 400);
      if (['delete', 'mark_test', 'unmark_test', 'mark_duplicate', 'unmark_duplicate'].includes(operation) && actor.role !== 'owner') {
        return json({ ok: false, error: 'owner_required' }, 403);
      }
      if (body.confirm !== true) return json({ ok: false, error: 'bulk_confirmation_required' }, 400);
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of ids) {
        try {
          if (operation === 'archive') await archiveLead(db, actor, id);
          else if (operation === 'restore') await restoreLead(db, actor, id);
          else if (operation === 'delete') await deleteDisposableLead(db, actor, id);
          else if (operation === 'mark_test') await markLeadTest(db, actor, id, true);
          else if (operation === 'unmark_test') await markLeadTest(db, actor, id, false);
          else if (operation === 'mark_duplicate') await markLeadDuplicate(db, actor, id, true);
          else if (operation === 'unmark_duplicate') await markLeadDuplicate(db, actor, id, false);
          else await markLeadConverted(db, actor, id);
          results.push({ id, ok: true });
        } catch (error) {
          results.push({
            id,
            ok: false,
            ...(error instanceof Error ? { error: error.message.slice(0, 120) } : {}),
          });
        }
      }
      const summary = summarizeLeadResults(results);
      return json({
        ok: true,
        operation,
        ...summary,
        succeeded: summary.completed,
        failed: summary.skipped,
        results,
      });
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
