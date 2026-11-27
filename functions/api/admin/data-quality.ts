// Owner property data-quality review and explicit archive/merge actions.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  archiveDuplicateProperty,
  listPropertyQualityGroups,
  mergeDuplicateProperty,
} from '../../../src/lib/admin/property-data-quality.ts';

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
    const result = await listPropertyQualityGroups(db, actor);
    return json({ ok: true, ...result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'property_review_failed' },
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
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'archive_property') {
      await archiveDuplicateProperty(db, actor, String(body.propertyId ?? ''), String(body.note ?? ''));
      return json({ ok: true });
    }
    if (action === 'merge_property') {
      await mergeDuplicateProperty(
        db,
        actor,
        String(body.sourcePropertyId ?? ''),
        String(body.targetPropertyId ?? ''),
        String(body.note ?? ''),
      );
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'property_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
