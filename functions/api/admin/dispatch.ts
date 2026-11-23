import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import type { GoogleCalendarEnv } from '../../../src/lib/booking/google-calendar.ts';
import type { RoutingEnv } from '../../../src/lib/travel/server-routing.ts';
import {
  addDispatchTimeOff,
  approveDispatchRecommendation,
  decideRecommendation,
  dispatchDashboard,
  manualAssignDispatchJob,
  retryDispatchCalendar,
  runDispatch,
  updateDispatchProfile,
  updateDispatchSettings,
  type DispatchEnv,
} from '../../../src/lib/dispatch/service.ts';
import { branchConfig, branchList } from '../../../src/config/branches.ts';

interface Env extends AdminDbEnv, RoutingEnv, GoogleCalendarEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function branchFor(actor: { role: string; branchId: string | null }, requested: unknown): string {
  const value = text(requested, 80);
  if (actor.role === 'owner' && branchConfig(value)) return value;
  return actor.branchId && branchConfig(actor.branchId) ? actor.branchId : 'branch_pensacola';
}

const SERVICES = [
  { code: 'standard', label: 'Residential cleaning' },
  { code: 'deep', label: 'Deep cleaning' },
  { code: 'move_in_out', label: 'Move-in / move-out' },
  { code: 'str_turnover', label: 'Short-term rental turnover' },
  { code: 'commercial-cleaning', label: 'Commercial cleaning' },
  { code: 'church-cleaning', label: 'Church cleaning' },
];

const EQUIPMENT = [
  { code: 'standard-kit', label: 'Standard residential kit' },
  { code: 'deep-kit', label: 'Deep-clean equipment' },
  { code: 'commercial-kit', label: 'Commercial equipment' },
];

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.read');
    const url = new URL(context.request.url);
    const branchId = branchFor(actor, url.searchParams.get('branchId'));
    const dashboard = await dispatchDashboard(db, actor, branchId);
    return json({
      ...dashboard,
      metadata: {
        services: SERVICES,
        equipment: EQUIPMENT,
        branches: branchList.map((branch) => ({ id: branch.id, name: branch.name, timezone: branch.timezone })),
      },
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'dispatch_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    const branchId = branchFor(actor, body.branchId);
    if (action === 'run_analysis') {
      const summary = await runDispatch(context.env as DispatchEnv, db, actor, { branchId, apply: false });
      return json({ ok: true, summary });
    }
    if (action === 'run_automatic') {
      const summary = await runDispatch(context.env as DispatchEnv, db, actor, { branchId, apply: true });
      return json({ ok: true, summary });
    }
    if (action === 'assign_job') {
      const teamMemberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.filter((value): value is string => typeof value === 'string')
        : [];
      const result = await manualAssignDispatchJob(context.env as DispatchEnv, db, actor, {
        branchId,
        appointmentId: text(body.appointmentId, 120),
        teamMemberIds,
      });
      return json({ ok: true, ...result });
    }
    if (action === 'update_settings') {
      const settings = await updateDispatchSettings(db, actor, branchId, body);
      return json({ ok: true, settings });
    }
    if (action === 'approve_recommendation') {
      const result = await approveDispatchRecommendation(context.env as DispatchEnv, db, actor, {
        branchId,
        decisionId: text(body.decisionId, 120),
      });
      return json({ ok: true, ...result });
    }
    if (action === 'reject_recommendation' || action === 'defer_recommendation' || action === 'dismiss_recommendation') {
      await decideRecommendation(db, actor, {
        branchId,
        decisionId: text(body.decisionId, 120),
        action: action.replace('_recommendation', '') as 'reject' | 'defer' | 'dismiss',
      });
      return json({ ok: true });
    }
    if (action === 'update_profile') {
      await updateDispatchProfile(db, actor, text(body.memberId, 120), body);
      return json({ ok: true });
    }
    if (action === 'retry_calendar') {
      const result = await retryDispatchCalendar(context.env as DispatchEnv, db, actor, {
        branchId,
        decisionId: text(body.decisionId, 120),
      });
      return json({ ok: true, ...result });
    }
    if (action === 'add_time_off') {
      await addDispatchTimeOff(db, actor, {
        memberId: text(body.memberId, 120),
        from: text(body.from, 60),
        to: text(body.to, 60),
        reason: text(body.reason, 300),
      });
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'dispatch_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
