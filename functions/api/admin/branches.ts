// Admin branch setup and launch lifecycle API.
//
// Identities are code-owned. This endpoint edits only the approved setup fields
// and requires the owner-level settings.write permission. Tampa Bay can be
// prepared here but cannot become publicly bookable without complete launch
// prerequisites and an explicit owner save.

import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  audit,
  requireActor,
  requireCsrf,
  type AdminActor,
} from '../../../src/lib/admin/operations.ts';
import {
  BranchSettingsError,
  branchOperationalReadiness,
  listBranchSettings,
  saveBranchSettings,
} from '../../../src/lib/branches/settings.ts';

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
  let actor: AdminActor;
  try {
    actor = await requireActor(db, context.request, 'settings.write');
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'unauthorized' },
      error instanceof AdminAuthError ? error.status : 401,
    );
  }
  try {
    const settings = await listBranchSettings(db);
    const branches = await Promise.all(settings.map(async (branch) => ({ ...branch, readiness: await branchOperationalReadiness(db, branch) })));
    return json({ ok: true, actor: { role: actor.role, branchId: actor.branchId }, branches });
  } catch {
    return json({ ok: false, error: 'branch_settings_load_failed' }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  let actor: AdminActor;
  try {
    actor = await requireActor(db, context.request, 'settings.write');
    requireCsrf(context.request, actor);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'unauthorized' },
      error instanceof AdminAuthError ? error.status : 401,
    );
  }
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
    if (!branchId) return json({ ok: false, error: 'branch_required' }, 400);
    const saved = await saveBranchSettings(db, { id: actor.id, email: actor.email }, branchId, body);
    await audit(db, {
      actorUserId: actor.id,
      action: 'branch.settings_saved',
      entityType: 'branch',
      entityId: saved.id,
      detail: `lifecycle ${saved.lifecycle}; slug ${saved.publicSlug}; services ${JSON.stringify(saved.services)}`,
    });
    const settings = await listBranchSettings(db);
    const branches = await Promise.all(settings.map(async (branch) => ({ ...branch, readiness: await branchOperationalReadiness(db, branch) })));
    return json({ ok: true, branch: { ...saved, readiness: await branchOperationalReadiness(db, saved) }, branches });
  } catch (error) {
    const status = error instanceof BranchSettingsError ? error.status : 500;
    const code = error instanceof BranchSettingsError ? error.code : 'branch_settings_save_failed';
    return json(
      { ok: false, error: code, message: error instanceof Error ? error.message.slice(0, 500) : undefined },
      status,
    );
  }
}
