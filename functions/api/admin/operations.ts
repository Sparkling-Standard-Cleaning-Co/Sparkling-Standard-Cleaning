import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import {
  applyRecurringScheduleChange,
  setRecurringStatus,
  syncRecurringPlan,
  type RecurringEnv,
} from '../../../src/lib/admin/recurring-schedule.ts';
import type { BookingEnv } from '../../../src/lib/booking/service.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  assignTeam,
  createChecklist,
  createRecurring,
  createTeamMember,
  getChecklist,
  listAppointments,
  listRecurring,
  listTeam,
  removeTeamMember,
  setAppointmentTeam,
  updateAppointmentStatus,
  updateChecklistItem,
  updateRecurring,
  updateTeamMember,
} from '../../../src/lib/admin/scheduling.ts';

interface Env extends AdminDbEnv, BookingEnv {}

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
    const actor = await requireActor(db, context.request, 'job.read');
    const url = new URL(context.request.url);
    const view = url.searchParams.get('view') ?? 'jobs';
    if (view === 'recurring') {
      return json({ ok: true, recurring: await listRecurring(db, actor) });
    }
    if (view === 'team') {
      return json({ ok: true, team: await listTeam(db, actor) });
    }
    if (view === 'checklist') {
      return json({ ok: true, checklist: await getChecklist(db, actor, url.searchParams.get('appointmentId') ?? '') });
    }
    const [jobs, team] = await Promise.all([
      listAppointments(db, actor, {
        from: url.searchParams.get('from') ?? '',
        to: url.searchParams.get('to') ?? '',
        status: url.searchParams.get('status') ?? '',
      }),
      listTeam(db, actor),
    ]);
    return json({ ok: true, jobs, team });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'operations_failed' },
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
    const recurringWriteEnabled = (context.env as { RECURRING_SCHEDULING_ENABLED?: string }).RECURRING_SCHEDULING_ENABLED === 'true';
    const recurringAction = body.action === 'create_recurring' || body.action === 'update_recurring';
    if (recurringAction && !recurringWriteEnabled) {
      return json({ ok: false, error: 'recurring_scheduling_gated' }, 503);
    }
    const action = String(body.action ?? '');
    if (action === 'create_recurring') {
      const created = await createRecurring(db, actor, body);
      const sync = await syncRecurringPlan(context.env as RecurringEnv, db, actor, created.id);
      return json({ ok: sync.ok, ...created, sync }, sync.ok ? 200 : 502);
    }
    if (action === 'update_recurring') {
      const planId = String(body.planId ?? '');
      const requestedStatus = String(body.status ?? '');
      const scheduleFields = ['frequency', 'startDate', 'window', 'startTime', 'durationMinutes', 'firstDurationMinutes', 'crewSize'];
      const changesSchedule = scheduleFields.some((field) => body[field] !== undefined && body[field] !== '');
      if (requestedStatus && requestedStatus !== 'active') {
        await updateRecurring(db, actor, planId, body);
        const sync = await setRecurringStatus(
          context.env as RecurringEnv,
          db,
          actor,
          planId,
          requestedStatus as 'paused' | 'cancelled' | 'completed',
        );
        return json({ ok: sync.ok, sync }, sync.ok ? 200 : 502);
      }
      if (changesSchedule) {
        const applied = await applyRecurringScheduleChange(
          context.env as RecurringEnv,
          db,
          actor,
          planId,
          {
            ...(body.frequency ? { frequency: String(body.frequency) } : {}),
            ...(body.startDate ? { startDate: String(body.startDate) } : {}),
            ...(body.window ? { window: String(body.window) } : {}),
            ...(body.startTime ? { startTime: String(body.startTime) } : {}),
            ...(body.durationMinutes ? { durationMinutes: Number(body.durationMinutes) } : {}),
            ...(body.firstDurationMinutes ? { firstDurationMinutes: Number(body.firstDurationMinutes) } : {}),
            ...(body.crewSize ? { crewSize: Number(body.crewSize) } : {}),
          },
        );
        if (!applied.ok) return json({ ...applied, ok: false }, 409);
        if (requestedStatus && ['active', 'paused', 'cancelled', 'completed'].includes(requestedStatus)) {
          const status = await setRecurringStatus(
            context.env as RecurringEnv,
            db,
            actor,
            planId,
            requestedStatus as 'active' | 'paused' | 'cancelled' | 'completed',
          );
          return json({ ok: status.ok, applied, sync: status }, status.ok ? 200 : 502);
        }
        return json({ ...applied, ok: true });
      }
      if (requestedStatus && ['active', 'paused', 'cancelled', 'completed'].includes(requestedStatus)) {
        await updateRecurring(db, actor, planId, body);
        const sync = await setRecurringStatus(
          context.env as RecurringEnv,
          db,
          actor,
          planId,
          requestedStatus as 'active' | 'paused' | 'cancelled' | 'completed',
        );
        return json({ ok: sync.ok, sync }, sync.ok ? 200 : 502);
      }
      await updateRecurring(db, actor, planId, body);
      return json({ ok: true });
    }
    if (action === 'create_team') return json({ ok: true, ...(await createTeamMember(db, actor, body)) });
    if (action === 'update_team') {
      await updateTeamMember(db, actor, String(body.memberId ?? ''), body);
      return json({ ok: true });
    }
    if (action === 'assign_team') {
      const memberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.map((value) => String(value)).filter(Boolean).slice(0, 12)
        : [];
      await assignTeam(db, actor, String(body.appointmentId ?? ''), memberIds);
      return json({ ok: true });
    }
    if (action === 'set_team') {
      const memberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.map((value) => String(value)).filter(Boolean).slice(0, 12)
        : [];
      const result = await setAppointmentTeam(db, actor, String(body.appointmentId ?? ''), memberIds);
      return json({ ok: true, ...result });
    }
    if (action === 'remove_team') {
      await removeTeamMember(
        db,
        actor,
        String(body.appointmentId ?? ''),
        String(body.teamMemberId ?? ''),
      );
      return json({ ok: true });
    }
    if (action === 'job_status') {
      await updateAppointmentStatus(db, actor, String(body.appointmentId ?? ''), String(body.status ?? ''));
      return json({ ok: true });
    }
    if (action === 'create_checklist') {
      return json({ ok: true, ...(await createChecklist(db, actor, String(body.appointmentId ?? ''))) });
    }
    if (action === 'checklist_item') {
      await updateChecklistItem(
        db,
        actor,
        String(body.itemId ?? ''),
        body.completed === true,
        String(body.notes ?? ''),
      );
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'operation_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
