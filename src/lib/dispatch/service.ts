import type { AdminActor } from '../admin/operations.ts';
import { AdminAuthError, audit } from '../admin/operations.ts';
import type { D1Database } from '../admin/d1.ts';
import { bookingConfig } from '../../config/booking.ts';
import { zonedTimeToUtc } from '../booking/time.ts';
import { branchConfig } from '../../config/branches.ts';
import { resolveRoute, type RoutingEnv } from '../travel/server-routing.ts';
import { syncAppointmentCalendarResources } from '../admin/scheduling.ts';
import { employeeOnboardingStatus } from '../documents/service.ts';
import type { GoogleCalendarEnv } from '../booking/google-calendar.ts';
import {
  evaluateDispatchJob,
  type DispatchCandidate,
  type DispatchEmployee,
  type DispatchJob,
  type DispatchLatLng,
  type DispatchRoute,
  type DispatchSettings,
} from './engine.ts';
import {
  assignedTeam,
  claimDispatchLock,
  listDispatchDecisions,
  listDispatchJobs,
  loadDispatchEmployees,
  loadDispatchJob,
  loadDispatchSettings,
  persistDecision,
  releaseDispatchLock,
  saveDispatchSettings,
  saveTeamDispatchProfile,
  updateDecisionStatus,
  timezoneForBranch,
  type DispatchSettingsRow,
} from './repository.ts';

export interface DispatchEnv extends RoutingEnv, GoogleCalendarEnv {
  DB?: D1Database;
}

const DISPATCH_ROUTE_CACHE_LIMIT = 600;

function routeResolver(env: DispatchEnv): (from: DispatchLatLng, to: DispatchLatLng) => Promise<DispatchRoute> {
  const cache = new Map<string, Promise<DispatchRoute>>();
  return async (from, to) => {
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = resolveRoute(env, from, to)
      .then((route) => ({
        minutes: route.durationMinutes === null ? null : Math.max(0, Math.round(route.durationMinutes)),
        miles: Math.max(0, route.oneWayMiles),
        verified: route.verified && route.method === 'route' && route.durationMinutes !== null,
      }))
      .catch(() => ({ minutes: null, miles: null, verified: false }));
    if (cache.size >= DISPATCH_ROUTE_CACHE_LIMIT) cache.clear();
    cache.set(key, pending);
    return pending;
  };
}

function dispatchInstant(value: string, timeZone: string): Date | null {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  if (!match) return null;
  try {
    return zonedTimeToUtc(match[1] as string, match[2] as string, timeZone);
  } catch {
    return null;
  }
}

function auditUserId(actor: AdminActor): string | null {
  return actor.id === 'system' ? null : actor.id;
}

function dispatchSettings(settings: DispatchSettingsRow): DispatchSettings {
  return {
    weights: settings.weights,
    vehicleCostCentsPerMile: settings.vehicleCostCentsPerMile,
    travelPayPercent: settings.travelPayPercent,
    maxCandidates: settings.maxCandidates,
    bufferMinutes: bookingConfig.jobBufferMinutes,
  };
}

function candidateSummary(candidate: DispatchCandidate): Record<string, unknown> {
  return {
    employeeIds: candidate.employeeIds,
    employeeNames: candidate.employeeNames,
    roles: candidate.roles,
    transport: candidate.transport,
    travelMinutes: candidate.travelMinutes,
    travelMiles: Math.round(candidate.travelMiles * 10) / 10,
    laborCents: candidate.laborCents,
    score: candidate.score,
    explanation: candidate.explanation,
  };
}

function localDateKey(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function dateRangeForDispatch(timeZone: string): { from: string; to: string; weekFrom: string; weekTo: string } {
  const now = new Date();
  const fromDate = localDateKey(now.toISOString(), timeZone);
  const to = new Date(now.getTime() + 14 * 86_400_000);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  return {
    from: `${fromDate}T00:00:00`,
    to: to.toISOString(),
    weekFrom: weekStart.toISOString(),
    weekTo: to.toISOString(),
  };
}

async function evaluate(job: DispatchJob, employees: DispatchEmployee[], settings: DispatchSettings, env: DispatchEnv) {
  return evaluateDispatchJob(job, employees, settings, routeResolver(env));
}

function appointmentScope(actor: AdminActor, branchId: string): void {
  if (actor.role === 'owner') return;
  if (actor.branchId !== branchId) throw new AdminAuthError(403, 'forbidden');
}

async function applyAssignment(
  db: D1Database,
  branchId: string,
  job: DispatchJob,
  candidate: DispatchCandidate,
  decisionId: string,
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  const claim = await db
    .prepare(
      `UPDATE appointments SET updated_at = ?
       WHERE id = ? AND branch_id = ? AND updated_at = ?
         AND status IN ('pending','confirmed')
         AND NOT EXISTS (SELECT 1 FROM appointment_resources WHERE appointment_id = ?)`,
    )
    .bind(updatedAt, job.id, branchId, job.updatedAt, job.id)
    .run();
  if (Number(claim.meta?.changes ?? 0) !== 1) return false;
  const statements = [
    ...candidate.employeeIds.map((teamMemberId) =>
      db
        .prepare(
          `INSERT INTO appointment_resources (appointment_id, team_member_id, role)
           SELECT ?, ?, CASE WHEN is_solo = 1 THEN 'solo' WHEN is_lead = 1 THEN 'lead' ELSE 'cleaner' END
           FROM team_members WHERE id = ? AND status = 'active' AND is_bookable = 1`,
        )
        .bind(job.id, teamMemberId, teamMemberId),
    ),
    db.prepare('UPDATE appointments SET crew_size = ? WHERE id = ?').bind(candidate.employeeIds.length, job.id),
    db.prepare("UPDATE dispatch_decisions SET status = 'applied', applied_at = ? WHERE id = ?").bind(updatedAt, decisionId),
  ];
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  const applied = await assignedTeam(db, job.id);
  return Boolean(applied && applied.ids.length === candidate.employeeIds.length && candidate.employeeIds.every((id) => applied.ids.includes(id)));
}

export interface DispatchRunSummary {
  branchId: string;
  scanned: number;
  assigned: number;
  exceptions: number;
  recommendations: number;
  skipped: number;
  details: Array<Record<string, unknown>>;
}

export async function runDispatch(
  env: DispatchEnv,
  db: D1Database,
  actor: AdminActor,
  input: { branchId: string; apply?: boolean },
): Promise<DispatchRunSummary> {
  const branchId = input.branchId;
  appointmentScope(actor, branchId);
  const settingsRow = await loadDispatchSettings(db, branchId);
  const settings = dispatchSettings(settingsRow);
  const apply = input.apply === true;
  if (apply) {
    if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
    if (!settingsRow.autoAssignEnabled || settingsRow.mode !== 'automatic_unassigned') {
      throw new AdminAuthError(409, 'automatic_dispatch_not_enabled');
    }
    if (settingsRow.paused) throw new AdminAuthError(409, 'automatic_dispatch_paused');
  }
  const lockOwner = `dispatch_${crypto.randomUUID()}`;
  if (apply && !(await claimDispatchLock(db, branchId, lockOwner))) {
    throw new AdminAuthError(409, 'dispatch_already_running');
  }
  const summary: DispatchRunSummary = {
    branchId,
    scanned: 0,
    assigned: 0,
    exceptions: 0,
    recommendations: 0,
    skipped: 0,
    details: [],
  };
  try {
    const timeZone = timezoneForBranch(branchId);
    const range = dateRangeForDispatch(timeZone);
    const unassigned = await listDispatchJobs(db, branchId, {
      unassignedOnly: true,
      from: new Date().toISOString(),
      to: range.to,
      limit: 100,
    });
    summary.scanned = unassigned.length;
    let employees = await loadDispatchEmployees(db, branchId, range.from.slice(0, 10), range.to.slice(0, 10));
    const onboarded: DispatchEmployee[] = [];
    for (const employee of employees) {
      const role = employee.isSolo ? 'solo' : employee.isLead ? 'lead' : 'helper';
      const onboarding = await employeeOnboardingStatus(db, employee.id, role);
      if (onboarding.satisfied) onboarded.push(employee);
    }
    employees = onboarded;
    for (const row of unassigned) {
      const job = await loadDispatchJob(db, branchId, String(row.id ?? ''));
      if (!job || job.assignedIds.length > 0 || job.status !== 'confirmed') {
        summary.skipped += 1;
        continue;
      }
      const evaluation = await evaluate(job, employees, settings, env);
      const best = evaluation.feasible[0];
      if (!best) {
        summary.exceptions += 1;
        if (apply) {
          await persistDecision(db, {
            branchId,
            appointmentId: job.id,
            kind: 'coverage_exception',
            status: 'blocked',
            currentTeam: [],
            chosenTeam: [],
            candidates: evaluation.blocked.slice(0, 8),
            constraints: evaluation.blocked.flatMap((entry) => entry.reasons).slice(0, 20),
            score: {},
            reason: 'No feasible eligible crew can cover this unassigned job.',
            scheduleVersion: job.updatedAt,
            calendarStatus: 'not_requested',
            actorUserId: auditUserId(actor),
          });
        }
        summary.details.push({ jobId: job.id, status: 'exception', reasons: [...new Set(evaluation.blocked.flatMap((entry) => entry.reasons))].slice(0, 8) });
        continue;
      }
      if (!apply) {
        summary.details.push({ jobId: job.id, status: 'candidate', candidate: candidateSummary(best) });
        continue;
      }
      const decisionId = await persistDecision(db, {
        branchId,
        appointmentId: job.id,
        kind: 'auto_assignment',
        status: 'proposed',
        currentTeam: [],
        chosenTeam: best.employeeIds,
        candidates: evaluation.feasible.slice(0, settings.maxCandidates).map(candidateSummary),
        constraints: [],
        score: best.score as unknown as Record<string, unknown>,
        reason: best.explanation.join(' '),
        scheduleVersion: job.updatedAt,
        calendarStatus: 'pending',
        actorUserId: auditUserId(actor),
      });
      const applied = await applyAssignment(db, branchId, job, best, decisionId).catch(() => false);
      if (!applied) {
        await updateDecisionStatus(db, decisionId, 'superseded', { reason: 'The job changed before the assignment could be committed.' });
        summary.skipped += 1;
        continue;
      }
      summary.assigned += 1;
      const calendar = await syncAppointmentCalendarResources(env, db, job.id).then(() => 'synced').catch(() => 'failed');
      await updateDecisionStatus(db, decisionId, 'applied', { calendarStatus: calendar });
      await audit(db, {
        actorUserId: auditUserId(actor),
        action: 'dispatch.auto_assigned',
        entityType: 'appointment',
        entityId: job.id,
        detail: `${best.employeeIds.join(',')}:${best.transport}:${best.travelMinutes}min`,
      });
      summary.details.push({ jobId: job.id, status: 'assigned', candidate: candidateSummary(best), calendar });
      employees = await loadDispatchEmployees(db, branchId, range.from.slice(0, 10), range.to.slice(0, 10));
    }
    if (settingsRow.reassignmentRecommendations) {
      const assignedJobs = await listDispatchJobs(db, branchId, {
        unassignedOnly: false,
        from: new Date().toISOString(),
        to: range.to,
        limit: 60,
      });
      for (const row of assignedJobs) {
        if (String(row.assigned_ids ?? '').trim() === '') continue;
        const job = await loadDispatchJob(db, branchId, String(row.id ?? ''));
        if (!job || job.assignedIds.length === 0) continue;
        const current = await assignedTeam(db, job.id);
        if (!current) continue;
        const existing = await listDispatchDecisions(db, branchId, { status: 'proposed', kind: 'recommendation', limit: 100 });
        if (existing.some((entry) => entry.appointment_id === job.id)) continue;
        const evaluation = await evaluate(job, employees, settings, env);
        const best = evaluation.feasible[0];
        if (!best) continue;
        if (best.employeeIds.length === current.ids.length && best.employeeIds.every((id) => current.ids.includes(id))) continue;
        const currentCandidate = evaluation.feasible.find((candidate) =>
          candidate.employeeIds.length === current.ids.length && candidate.employeeIds.every((id) => current.ids.includes(id)),
        );
        if (!currentCandidate) continue;
        const savingsCents = Math.max(0, currentCandidate.laborCents - best.laborCents);
        const travelSaving = Math.max(0, currentCandidate.travelMinutes - best.travelMinutes);
        if (savingsCents < settingsRow.minSavingsCents && travelSaving < 15) continue;
        if (best.score.total >= currentCandidate.score.total - 2) continue;
        await persistDecision(db, {
          branchId,
          appointmentId: job.id,
          kind: 'recommendation',
          status: 'proposed',
          currentTeam: current.ids,
          chosenTeam: best.employeeIds,
          candidates: evaluation.feasible.slice(0, settings.maxCandidates).map(candidateSummary),
          constraints: [],
          score: { current: currentCandidate.score, proposed: best.score },
          reason: `${best.explanation.join(' ')} Estimated travel change: ${currentCandidate.travelMinutes - best.travelMinutes} minutes; estimated labor change: ${Math.round((currentCandidate.laborCents - best.laborCents) / 100)} dollars.`,
          scheduleVersion: current.updatedAt,
          calendarStatus: 'not_requested',
          actorUserId: auditUserId(actor),
        });
        summary.recommendations += 1;
      }
    }
    await audit(db, {
      actorUserId: auditUserId(actor),
      action: apply ? 'dispatch.auto_run' : 'dispatch.analysis_run',
      entityType: 'branch',
      entityId: branchId,
      detail: `scanned=${summary.scanned};assigned=${summary.assigned};exceptions=${summary.exceptions};recommendations=${summary.recommendations}`,
    });
    return summary;
  } finally {
    if (apply) await releaseDispatchLock(db, branchId, lockOwner).catch(() => undefined);
  }
}

export async function approveDispatchRecommendation(
  env: DispatchEnv,
  db: D1Database,
  actor: AdminActor,
  input: { branchId: string; decisionId: string },
): Promise<{ applied: boolean; calendar: string }> {
  appointmentScope(actor, input.branchId);
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const decision = await db
    .prepare(
      `SELECT d.* FROM dispatch_decisions d
       WHERE d.id = ? AND d.branch_id = ? AND d.kind = 'recommendation' AND d.status = 'proposed' LIMIT 1`,
    )
    .bind(input.decisionId, input.branchId)
    .first<Record<string, unknown>>();
  if (!decision) throw new AdminAuthError(404, 'recommendation_not_found');
  const job = await loadDispatchJob(db, input.branchId, String(decision.appointment_id ?? ''));
  if (!job) throw new AdminAuthError(404, 'appointment_not_found');
  const current = await assignedTeam(db, job.id);
  if (!current) throw new AdminAuthError(404, 'appointment_not_found');
  const expected = JSON.parse(String(decision.current_team_json ?? '[]')) as string[];
  if (current.updatedAt !== String(decision.schedule_version ?? '') || expected.some((id) => !current.ids.includes(id)) || current.ids.length !== expected.length) {
    await updateDecisionStatus(db, input.decisionId, 'superseded', { reason: 'The appointment changed after this recommendation was created.' });
    throw new AdminAuthError(409, 'recommendation_stale');
  }
  const chosen = JSON.parse(String(decision.chosen_team_json ?? '[]')) as string[];
  const settingsRow = await loadDispatchSettings(db, input.branchId);
  const employees = await loadDispatchEmployees(
    db,
    input.branchId,
    localDateKey(job.start, job.timeZone),
    localDateKey(new Date(Date.parse(job.start) + 30 * 86_400_000).toISOString(), job.timeZone),
  );
  const evaluation = await evaluate(job, employees.filter((employee) => !current.ids.includes(employee.id) || chosen.includes(employee.id)), dispatchSettings(settingsRow), env);
  const candidate = evaluation.feasible.find((entry) => chosen.length === entry.employeeIds.length && chosen.every((id) => entry.employeeIds.includes(id)));
  if (!candidate) throw new AdminAuthError(409, 'recommendation_no_longer_feasible');
  const lockOwner = `approval_${crypto.randomUUID()}`;
  if (!(await claimDispatchLock(db, input.branchId, lockOwner))) throw new AdminAuthError(409, 'dispatch_already_running');
  try {
    const claim = await db
      .prepare('UPDATE appointments SET crew_size = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
      .bind(candidate.employeeIds.length, new Date().toISOString(), job.id, current.updatedAt)
      .run();
    if (Number(claim.meta?.changes ?? 0) !== 1) {
      throw new AdminAuthError(409, 'recommendation_stale');
    }
    const statements = [
      db.prepare('DELETE FROM appointment_resources WHERE appointment_id = ?').bind(job.id),
      ...candidate.employeeIds.map((teamMemberId) =>
        db
          .prepare(
            `INSERT INTO appointment_resources (appointment_id, team_member_id, role)
             SELECT ?, ?, CASE WHEN is_solo = 1 THEN 'solo' WHEN is_lead = 1 THEN 'lead' ELSE 'cleaner' END
             FROM team_members WHERE id = ? AND status = 'active' AND is_bookable = 1`,
          )
          .bind(job.id, teamMemberId, teamMemberId),
      ),
      db.prepare("UPDATE dispatch_decisions SET status = 'applied', applied_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), input.decisionId),
    ];
    if (db.batch) await db.batch(statements);
    else for (const statement of statements) await statement.run();
    const calendar = await syncAppointmentCalendarResources(env, db, job.id).then(() => 'synced').catch(() => 'failed');
    await updateDecisionStatus(db, input.decisionId, 'applied', { calendarStatus: calendar, chosenTeam: candidate.employeeIds });
    await audit(db, {
      actorUserId: auditUserId(actor),
      action: 'dispatch.reassignment_approved',
      entityType: 'appointment',
      entityId: job.id,
      detail: `${expected.join(',')}->${candidate.employeeIds.join(',')}`,
    });
    return { applied: true, calendar };
  } finally {
    await releaseDispatchLock(db, input.branchId, lockOwner).catch(() => undefined);
  }
}

export async function manualAssignDispatchJob(
  env: DispatchEnv,
  db: D1Database,
  actor: AdminActor,
  input: { branchId: string; appointmentId: string; teamMemberIds: string[] },
): Promise<{ applied: boolean; calendar: string; employeeNames: string[] }> {
  appointmentScope(actor, input.branchId);
  const ids = [...new Set(input.teamMemberIds.filter(Boolean))];
  if (ids.length === 0 || ids.length > bookingConfig.maxCrewSize) {
    throw new AdminAuthError(400, 'crew_selection_invalid');
  }
  const job = await loadDispatchJob(db, input.branchId, input.appointmentId);
  if (!job) throw new AdminAuthError(404, 'appointment_not_found');
  if (!['pending', 'confirmed'].includes(job.status)) {
    throw new AdminAuthError(409, 'appointment_not_assignable');
  }
  if (job.assignedIds.length > 0) {
    throw new AdminAuthError(409, 'appointment_already_assigned');
  }
  const settingsRow = await loadDispatchSettings(db, input.branchId);
  const employees = await loadDispatchEmployees(
    db,
    input.branchId,
    localDateKey(job.start, job.timeZone),
    localDateKey(new Date(Date.parse(job.start) + 30 * 86_400_000).toISOString(), job.timeZone),
  );
  const evaluation = await evaluate(job, employees, dispatchSettings(settingsRow), env);
  const candidate = evaluation.feasible.find(
    (entry) => entry.employeeIds.length === ids.length && ids.every((id) => entry.employeeIds.includes(id)),
  );
  if (!candidate) {
    const blocked = evaluation.blocked
      .filter((entry) => entry.employeeIds.some((id) => ids.includes(id)))
      .flatMap((entry) => entry.reasons)
      .slice(0, 4);
    throw new AdminAuthError(409, blocked[0] ?? 'crew_not_feasible');
  }
  const decisionId = await persistDecision(db, {
    branchId: input.branchId,
    appointmentId: job.id,
    kind: 'manual_assignment',
    status: 'proposed',
    currentTeam: [],
    chosenTeam: candidate.employeeIds,
    candidates: evaluation.feasible.map(candidateSummary),
    constraints: evaluation.blocked,
    score: { total: candidate.score.total, explanation: candidate.explanation },
    reason: 'Manual assignment by dispatcher',
    scheduleVersion: job.updatedAt,
    calendarStatus: 'pending',
    actorUserId: auditUserId(actor),
  });
  const applied = await applyAssignment(db, input.branchId, job, candidate, decisionId);
  if (!applied) {
    await updateDecisionStatus(db, decisionId, 'superseded', { reason: 'The appointment changed before assignment.' });
    throw new AdminAuthError(409, 'appointment_changed');
  }
  const calendar = await syncAppointmentCalendarResources(env, db, job.id).then(() => 'synced').catch(() => 'failed');
  await updateDecisionStatus(db, decisionId, 'applied', {
    calendarStatus: calendar,
    chosenTeam: candidate.employeeIds,
  });
  await audit(db, {
    actorUserId: auditUserId(actor),
    action: 'dispatch.manual_assigned',
    entityType: 'appointment',
    entityId: job.id,
    detail: candidate.employeeIds.join(','),
  });
  return { applied: true, calendar, employeeNames: candidate.employeeNames };
}

export async function decideRecommendation(
  db: D1Database,
  actor: AdminActor,
  input: { branchId: string; decisionId: string; action: 'reject' | 'defer' | 'dismiss' },
): Promise<void> {
  appointmentScope(actor, input.branchId);
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const status = input.action === 'reject' ? 'rejected' : input.action === 'defer' ? 'deferred' : 'dismissed';
  const decision = await db
    .prepare("SELECT id FROM dispatch_decisions WHERE id = ? AND branch_id = ? AND status = 'proposed' LIMIT 1")
    .bind(input.decisionId, input.branchId)
    .first();
  if (!decision) throw new AdminAuthError(404, 'recommendation_not_found');
  await updateDecisionStatus(db, input.decisionId, status);
  await audit(db, {
    actorUserId: auditUserId(actor),
    action: `dispatch.recommendation_${status}`,
    entityType: 'dispatch_decision',
    entityId: input.decisionId,
  });
}

export async function updateDispatchSettings(
  db: D1Database,
  actor: AdminActor,
  branchId: string,
  input: Record<string, unknown>,
): Promise<DispatchSettingsRow> {
  appointmentScope(actor, branchId);
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const settings = await saveDispatchSettings(db, branchId, actor.id, {
    ...(typeof input.mode === 'string' ? { mode: input.mode } : {}),
    ...(typeof input.autoAssignEnabled === 'boolean' ? { autoAssignEnabled: input.autoAssignEnabled } : {}),
    ...(typeof input.reassignmentRecommendations === 'boolean' ? { reassignmentRecommendations: input.reassignmentRecommendations } : {}),
    ...(typeof input.customerReschedulingRecommendations === 'boolean' ? { customerReschedulingRecommendations: input.customerReschedulingRecommendations } : {}),
    ...(typeof input.paused === 'boolean' ? { paused: input.paused } : {}),
    ...(Number.isFinite(Number(input.minSavingsCents)) ? { minSavingsCents: Number(input.minSavingsCents) } : {}),
    ...(Number.isFinite(Number(input.maxCandidates)) ? { maxCandidates: Number(input.maxCandidates) } : {}),
    ...(Number.isFinite(Number(input.vehicleCostCentsPerMile)) ? { vehicleCostCentsPerMile: Number(input.vehicleCostCentsPerMile) } : {}),
    ...(Number.isFinite(Number(input.travelPayPercent)) ? { travelPayPercent: Number(input.travelPayPercent) } : {}),
    ...(input.weights && typeof input.weights === 'object'
      ? { weights: Object.fromEntries(Object.entries(input.weights as Record<string, unknown>).map(([key, value]) => [key, Number(value)]).filter(([, value]) => Number.isFinite(value))) }
      : {}),
  });
  await audit(db, {
    actorUserId: auditUserId(actor),
    action: 'dispatch.settings_updated',
    entityType: 'branch',
    entityId: branchId,
    detail: `${settings.mode}:${settings.autoAssignEnabled}:${settings.paused}`,
  });
  return settings;
}

export async function updateDispatchProfile(
  db: D1Database,
  actor: AdminActor,
  memberId: string,
  input: Record<string, unknown>,
): Promise<void> {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const member = await db
    .prepare('SELECT id, branch_id FROM team_members WHERE id = ? LIMIT 1')
    .bind(memberId)
    .first<{ id: string; branch_id: string | null }>();
  if (!member) throw new AdminAuthError(404, 'team_not_found');
  if (member.branch_id) appointmentScope(actor, member.branch_id);
  await saveTeamDispatchProfile(db, memberId, input);
  await audit(db, {
    actorUserId: auditUserId(actor),
    action: 'dispatch.profile_updated',
    entityType: 'team_member',
    entityId: memberId,
  });
}

export async function retryDispatchCalendar(
  env: DispatchEnv,
  db: D1Database,
  actor: AdminActor,
  input: { branchId: string; decisionId: string },
): Promise<{ calendar: string }> {
  appointmentScope(actor, input.branchId);
  const decision = await db
    .prepare('SELECT id, appointment_id FROM dispatch_decisions WHERE id = ? AND branch_id = ? LIMIT 1')
    .bind(input.decisionId, input.branchId)
    .first<Record<string, unknown>>();
  if (!decision) throw new AdminAuthError(404, 'decision_not_found');
  const calendar = await syncAppointmentCalendarResources(env, db, String(decision.appointment_id ?? ''))
    .then(() => 'synced')
    .catch(() => 'failed');
  await updateDecisionStatus(db, input.decisionId, String(decision.status ?? 'applied'), { calendarStatus: calendar });
  await audit(db, {
    actorUserId: auditUserId(actor),
    action: 'dispatch.calendar_retry',
    entityType: 'dispatch_decision',
    entityId: input.decisionId,
    detail: calendar,
  });
  return { calendar };
}

export async function addDispatchTimeOff(
  db: D1Database,
  actor: AdminActor,
  input: { memberId: string; from: string; to: string; reason: string },
): Promise<void> {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const member = await db
    .prepare('SELECT id, branch_id FROM team_members WHERE id = ? LIMIT 1')
    .bind(input.memberId)
    .first<{ id: string; branch_id: string | null }>();
  if (!member) throw new AdminAuthError(404, 'team_not_found');
  if (member.branch_id) appointmentScope(actor, member.branch_id);
  const timeZone = timezoneForBranch(member.branch_id ?? 'branch_pensacola');
  const start = dispatchInstant(input.from, timeZone);
  const end = dispatchInstant(input.to, timeZone);
  if (!start || !end || end <= start) {
    throw new AdminAuthError(400, 'time_off_window_invalid');
  }
  await db
    .prepare('INSERT INTO team_time_off (id, team_member_id, start_at, end_at, reason) VALUES (?, ?, ?, ?, ?)')
    .bind(
      `timeoff_${crypto.randomUUID()}`,
      input.memberId,
      start.toISOString(),
      end.toISOString(),
      input.reason.slice(0, 300),
    )
    .run();
  await audit(db, {
    actorUserId: auditUserId(actor),
    action: 'dispatch.time_off_added',
    entityType: 'team_member',
    entityId: input.memberId,
    detail: `${start.toISOString()}:${end.toISOString()}`,
  });
}

export async function dispatchDashboard(
  db: D1Database,
  actor: AdminActor,
  branchId: string,
): Promise<Record<string, unknown>> {
  appointmentScope(actor, branchId);
  const settings = await loadDispatchSettings(db, branchId);
  const timeZone = timezoneForBranch(branchId);
  const range = dateRangeForDispatch(timeZone);
  const [unassigned, jobs, decisions] = await Promise.all([
    listDispatchJobs(db, branchId, { unassignedOnly: true, from: new Date().toISOString(), to: range.to, limit: 100 }),
    listDispatchJobs(db, branchId, { from: new Date().toISOString(), to: range.to, limit: 200 }),
    listDispatchDecisions(db, branchId, { limit: 30 }),
  ]);
  const teamRows = await db
    .prepare(
      `SELECT id, display_name, branch_id, status, is_bookable, is_solo, is_lead,
              dispatch_services_json, dispatch_equipment_json, dispatch_transport_mode,
              dispatch_can_drive, dispatch_vehicle_seats, dispatch_can_transport_equipment,
              dispatch_max_weekly_hours, dispatch_overtime_approved, workdays, workday_start, workday_end,
              dispatch_origin_address, dispatch_origin_lat, dispatch_origin_lng,
              dispatch_alt_origin_address, dispatch_alt_origin_lat, dispatch_alt_origin_lng,
              dispatch_notes
       FROM team_members WHERE (branch_id = ? OR branch_id IS NULL) ORDER BY display_name`,
    )
    .bind(branchId)
    .all<Record<string, unknown>>();
  const team = await Promise.all((teamRows.results ?? []).map(async (row) => {
    const role = Number(row.is_solo) === 1 ? 'solo' : Number(row.is_lead) === 1 ? 'lead' : 'helper';
    const onboarding = await employeeOnboardingStatus(db, String(row.id), role);
    let services: string[] = [];
    let equipment: string[] = [];
    try { services = JSON.parse(String(row.dispatch_services_json ?? '[]')) as string[]; } catch { services = []; }
    try { equipment = JSON.parse(String(row.dispatch_equipment_json ?? '[]')) as string[]; } catch { equipment = []; }
    const workdays = String(row.workdays ?? '').split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    const readiness: string[] = [];
    if (String(row.status) !== 'active') readiness.push('employee_inactive');
    if (Number(row.is_bookable) !== 1) readiness.push('employee_not_bookable');
    if (services.length === 0) readiness.push('service_qualifications_missing');
    if (equipment.length === 0) readiness.push('equipment_qualifications_missing');
    if (String(row.dispatch_transport_mode ?? 'unknown') === 'unknown') readiness.push('transport_not_configured');
    if (row.dispatch_origin_lat === null || row.dispatch_origin_lng === null) readiness.push('dispatch_origin_missing');
    if (workdays.length === 0) readiness.push('availability_missing');
    if (!onboarding.satisfied) readiness.push('onboarding_requirements_missing');
    return ({
    id: row.id,
    name: row.display_name,
    status: row.status,
    bookable: Number(row.is_bookable) === 1,
    role,
    services,
    equipment,
    transportMode: row.dispatch_transport_mode,
    canDrive: Number(row.dispatch_can_drive) === 1,
    seats: Number(row.dispatch_vehicle_seats ?? 0),
    canTransportEquipment: Number(row.dispatch_can_transport_equipment) === 1,
    maxWeeklyHours: Number(row.dispatch_max_weekly_hours ?? 40),
    workdays,
    workdayStart: String(row.workday_start ?? '07:00'),
    workdayEnd: String(row.workday_end ?? '18:00'),
    overtimeApproved: Number(row.dispatch_overtime_approved) === 1,
    originConfigured: row.dispatch_origin_lat !== null && row.dispatch_origin_lng !== null,
    originAddress: actor.role === 'owner' ? row.dispatch_origin_address : '',
    originLat: actor.role === 'owner' ? row.dispatch_origin_lat : null,
    originLng: actor.role === 'owner' ? row.dispatch_origin_lng : null,
    altOriginAddress: actor.role === 'owner' ? row.dispatch_alt_origin_address : '',
    altOriginLat: actor.role === 'owner' ? row.dispatch_alt_origin_lat : null,
    altOriginLng: actor.role === 'owner' ? row.dispatch_alt_origin_lng : null,
    notes: actor.role === 'owner' ? row.dispatch_notes : '',
    readiness,
    onboarding: { satisfied: onboarding.satisfied, bundleCode: onboarding.bundleCode, missing: onboarding.missing.map((entry) => entry.title) },
    });
  }));
  const teamById = new Map(team.map((entry) => [String(entry.id), entry]));
  const unassignedIds = new Set(unassigned.map((row) => String(row.id)));
  const lanes = new Map<string, { id: string; name: string; jobs: Array<Record<string, unknown>> }>();
  for (const member of team) lanes.set(String(member.id), { id: String(member.id), name: String(member.name), jobs: [] });
  const unassignedLane: { id: string; name: string; jobs: Array<Record<string, unknown>> } = { id: 'unassigned', name: 'Unassigned', jobs: [] };
  for (const row of jobs) {
    const ids = String(row.assigned_ids ?? '').split(',').filter(Boolean);
    const summary = {
      id: row.id,
      reference: row.reference,
      startAt: row.start_at,
      endAt: row.end_at,
      customer: [row.first_name, row.last_name].filter(Boolean).join(' '),
      location: [row.line1, row.city, row.state].filter(Boolean).join(', '),
      status: row.status,
      crewSize: row.crew_size,
      serviceCode: row.estimate_service_code || row.recurring_service_code || 'standard',
      assignedIds: ids,
      unassigned: unassignedIds.has(String(row.id)),
    };
    if (ids.length === 0) unassignedLane.jobs.push(summary);
    for (const id of ids) {
      const lane = lanes.get(id) ?? { id, name: String(teamById.get(id)?.name ?? id), jobs: [] };
      lane.jobs.push(summary);
      lanes.set(id, lane);
    }
  }
  const today = localDateKey(new Date().toISOString(), timeZone);
  const assignedToday = jobs.filter((row) => localDateKey(String(row.start_at), timeZone) === today && String(row.assigned_ids ?? '').trim() !== '').length;
  const autoToday = decisions.filter((entry) => entry.kind === 'auto_assignment' && entry.status === 'applied' && localDateKey(String(entry.created_at), timeZone) === today).length;
  const pendingRecommendations = decisions.filter((entry) => entry.kind === 'recommendation' && entry.status === 'proposed');
  const exceptions = decisions.filter((entry) => entry.kind === 'coverage_exception' && entry.status === 'blocked');
  return {
    ok: true,
    branchId,
    timezone: timeZone,
    settings: {
      mode: settings.mode,
      autoAssignEnabled: settings.autoAssignEnabled,
      reassignmentRecommendations: settings.reassignmentRecommendations,
      customerReschedulingRecommendations: settings.customerReschedulingRecommendations,
      paused: settings.paused,
      minSavingsCents: settings.minSavingsCents,
      maxCandidates: settings.maxCandidates,
      vehicleCostCentsPerMile: settings.vehicleCostCentsPerMile,
      travelPayPercent: settings.travelPayPercent,
      weights: settings.weights,
      updatedAt: settings.updatedAt,
    },
    counts: {
      unassigned: unassigned.length,
      assignedToday,
      autoAssignedToday: autoToday,
      pendingRecommendations: pendingRecommendations.length,
      coverageExceptions: exceptions.length,
      team: team.length,
      dispatchReady: team.filter((member) => member.readiness.length === 0).length,
    },
    unassigned: unassigned.map((row) => ({
      id: row.id,
      reference: row.reference,
      startAt: row.start_at,
      endAt: row.end_at,
      customer: [row.first_name, row.last_name].filter(Boolean).join(' '),
      location: [row.line1, row.city, row.state].filter(Boolean).join(', '),
      serviceCode: row.estimate_service_code || row.recurring_service_code || 'standard',
      crewSize: row.crew_size,
    })),
    recommendations: pendingRecommendations.slice(0, 20),
    exceptions: exceptions.slice(0, 20),
    decisions: decisions.map((entry) => ({
      id: entry.id,
      appointmentId: entry.appointment_id,
      reference: entry.reference,
      kind: entry.kind,
      status: entry.status,
      reason: entry.reason,
      calendarStatus: entry.calendar_status,
      createdAt: entry.created_at,
      appliedAt: entry.applied_at,
      currentTeam: (() => { try { return JSON.parse(String(entry.current_team_json ?? '[]')) as unknown; } catch { return []; } })(),
      chosenTeam: (() => { try { return JSON.parse(String(entry.chosen_team_json ?? '[]')) as unknown; } catch { return []; } })(),
      candidateCount: (() => { try { return (JSON.parse(String(entry.candidates_json ?? '[]')) as unknown[]).length; } catch { return 0; } })(),
      candidateNames: (() => {
        try {
          const list = JSON.parse(String(entry.candidates_json ?? '[]')) as Array<{ employeeNames?: string[] }>;
          return [...new Set(list.flatMap((candidate) => candidate.employeeNames ?? []))].join(', ');
        } catch {
          return '';
        }
      })(),
    })),
    lanes: [unassignedLane, ...lanes.values()],
    team,
  };
}

export function dispatchReadiness(settings: DispatchSettingsRow): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!settings.autoAssignEnabled) reasons.push('automatic_assignment_disabled');
  if (settings.mode !== 'automatic_unassigned') reasons.push('mode_is_analysis_only');
  if (settings.paused) reasons.push('emergency_pause_active');
  return { ready: reasons.length === 0, reasons };
}

export function settingsBranch(branchId: string): boolean {
  return Boolean(branchConfig(branchId));
}
