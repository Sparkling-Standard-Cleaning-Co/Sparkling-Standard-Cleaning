import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  createPromotion,
  duplicatePromotion,
  getPromotion,
  listPromotions,
  setPromotionStatus,
  updatePromotion,
  type PromotionStatus,
} from '../../../src/lib/promotions/service.ts';

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
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const id = new URL(context.request.url).searchParams.get('id') ?? '';
    if (id) {
      const promotion = await getPromotion(db, id);
      if (!promotion) return json({ ok: false, error: 'promotion_not_found' }, 404);
      return json({ ok: true, promotion });
    }
    return json({ ok: true, promotions: await listPromotions(db) });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'promotions_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'create') return json({ ok: true, ...(await createPromotion(db, actor.id, body)) });
    if (action === 'update') {
      return json({
        ok: true,
        ...(await updatePromotion(db, actor.id, String(body.id ?? ''), body)),
      });
    }
    if (action === 'status') {
      const status = String(body.status ?? 'draft');
      if (!['draft', 'active', 'disabled', 'expired'].includes(status)) {
        return json({ ok: false, error: 'promotion_status_invalid' }, 400);
      }
      await setPromotionStatus(db, String(body.id ?? ''), status as PromotionStatus);
      return json({ ok: true });
    }
    if (action === 'duplicate') {
      return json({ ok: true, ...(await duplicatePromotion(db, actor.id, String(body.id ?? ''))) });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : (error as Error).message || 'promotion_update_failed' },
      error instanceof AdminAuthError ? error.status : 400,
    );
  }
}
