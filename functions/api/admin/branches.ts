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
  type BranchSettings,
} from '../../../src/lib/branches/settings.ts';
import {
  calendarEnvForBranchWithDb,
  calendarStatus,
  type GoogleCalendarEnv,
} from '../../../src/lib/booking/google-calendar.ts';

interface Env extends AdminDbEnv, GoogleCalendarEnv {}

function maskCalendarId(value: string): string {
  const id = value.trim();
  if (!id) return '';
  const at = id.indexOf('@');
  if (at > 1) return `${id.slice(0, 4)}…${id.slice(at)}`;
  return id.length <= 10 ? '••••' : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function calendarBinding(env: GoogleCalendarEnv, branch: BranchSettings): Record<string, unknown> {
  const saved = branch.calendarId.trim();
  const environmentVariable =
    branch.id === 'branch_tampa'
      ? 'GOOGLE_CALENDAR_ID_TAMPA'
      : 'GOOGLE_CALENDAR_ID_PENSACOLA (or legacy GOOGLE_CALENDAR_ID)';
  const envValue =
    branch.id === 'branch_tampa'
      ? env.GOOGLE_CALENDAR_ID_TAMPA?.trim() ?? ''
      : env.GOOGLE_CALENDAR_ID_PENSACOLA?.trim() || env.GOOGLE_CALENDAR_ID?.trim() || '';
  const effective = saved || envValue;
  return {
    configured: Boolean(effective),
    source: saved ? 'branch_settings' : envValue ? 'environment' : 'not_configured',
    environmentVariable,
    savedName: branch.calendarName || '',
    effectiveHint: maskCalendarId(effective),
    savedValueMatchesEnvironment: Boolean(saved && envValue && saved === envValue),
  };
}

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
    const url = new URL(context.request.url);
    const settings = await listBranchSettings(db);
    if (url.searchParams.get('view') === 'calendar_status') {
      const branchId = url.searchParams.get('branchId') ?? '';
      const branch = settings.find((entry) => entry.id === branchId);
      if (!branch) return json({ ok: false, error: 'branch_not_found' }, 404);
      const bound = await calendarEnvForBranchWithDb(context.env, db, branch.id);
      if (!bound) {
        return json({
          ok: true,
          connected: false,
          configured: false,
          reason: 'not_configured',
          binding: calendarBinding(context.env, branch),
        });
      }
      const status = await calendarStatus(bound);
      return json({
        ok: true,
        configured: status.configured,
        connected: status.connected,
        reason: status.reason ?? '',
        calendarName: status.calendarName ?? '',
        timeZone: status.timeZone ?? '',
        binding: calendarBinding(context.env, branch),
      });
    }
    const branches = await Promise.all(
      settings.map(async (branch) => ({
        ...branch,
        readiness: await branchOperationalReadiness(db, branch),
        calendarBinding: calendarBinding(context.env, branch),
      })),
    );
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
    const branches = await Promise.all(
      settings.map(async (branch) => ({
        ...branch,
        readiness: await branchOperationalReadiness(db, branch),
        calendarBinding: calendarBinding(context.env, branch),
      })),
    );
    return json({
      ok: true,
      branch: {
        ...saved,
        readiness: await branchOperationalReadiness(db, saved),
        calendarBinding: calendarBinding(context.env, saved),
      },
      branches,
    });
  } catch (error) {
    const status = error instanceof BranchSettingsError ? error.status : 500;
    const code = error instanceof BranchSettingsError ? error.code : 'branch_settings_save_failed';
    return json(
      { ok: false, error: code, message: error instanceof Error ? error.message.slice(0, 500) : undefined },
      status,
    );
  }
}
