// Employee administration, training, quality and payroll calculation API.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { sendOperationalNotification, type CommunicationEnv } from '../../../src/lib/admin/communications.ts';
import {
  acknowledgeHandbook,
  addOnboardingTask,
  addPerformanceNote,
  assignTraining,
  completeTraining,
  createEmployeeAgreementRequest,
  createQualityInspection,
  createTrainingModule,
  employeeDocumentExpirations,
  listEmployeeProfiles,
  listOnboarding,
  listPerformanceNotes,
  listQualityInspections,
  listTimeOffRequests,
  reviewTimeOffRequest,
  listTrainingAssignments,
  listTrainingModules,
  listShiftOverrides,
  setShiftOverride,
  setOnboardingStatus,
  updateEmployeeProfile,
} from '../../../src/lib/employee/admin.ts';
import {
  addPayrollAdjustment,
  approvePayrollPeriod,
  calculatePayrollPeriod,
  createPayrollPeriod,
  getPayrollPeriod,
  listPayrollPeriods,
  payrollCsv,
} from '../../../src/lib/employee/payroll.ts';

interface Env extends AdminDbEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function assertMemberScope(
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: { role: string; branchId: string | null },
  teamMemberId: string,
): Promise<void> {
  if (actor.role === 'owner') return;
  if (!actor.branchId || !teamMemberId) throw new AdminAuthError(403, 'branch_scope_denied');
  const row = await db
    .prepare('SELECT branch_id FROM team_members WHERE id = ? LIMIT 1')
    .bind(teamMemberId)
    .first<{ branch_id: string | null }>();
  if (!row || row.branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'branch_scope_denied');
  }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.read');
    const url = new URL(context.request.url);
    const view = text(url.searchParams.get('view'), 30) || 'all';
    const payrollView = view === 'payroll' || view === 'payroll_csv';
    if (payrollView && !['owner', 'finance'].includes(actor.role)) {
      return json({ ok: false, error: 'finance_required' }, 403);
    }
    if (!payrollView && !['owner', 'manager'].includes(actor.role)) {
      return json({ ok: false, error: 'manager_required' }, 403);
    }
    if (view === 'member') {
      const memberId = text(url.searchParams.get('id'), 100);
      if (!memberId) return json({ ok: false, error: 'employee_required' }, 400);
      await assertMemberScope(db, actor, memberId);
      const [onboarding, training, performance, expirations, shifts] = await Promise.all([
        listOnboarding(db, memberId),
        listTrainingAssignments(db, memberId),
        listPerformanceNotes(db, memberId),
        employeeDocumentExpirations(db, memberId),
        listShiftOverrides(db, memberId),
      ]);
      return json({ ok: true, onboarding, training, performance, expirations, shifts });
    }
    if (view === 'payroll') {
      const periodId = text(url.searchParams.get('id'), 100);
      if (!periodId) return json({ ok: false, error: 'payroll_period_required' }, 400);
      return json({ ok: true, ...(await getPayrollPeriod(db, periodId)) });
    }
    if (view === 'payroll_csv') {
      const periodId = text(url.searchParams.get('id'), 100);
      const detail = await getPayrollPeriod(db, periodId);
      const csv = payrollCsv(detail.period, detail.entries);
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="payroll-${String(detail.period.period_start)}-${String(detail.period.period_end)}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const [profiles, modules, assignments, inspections, payroll, timeOff] = await Promise.all([
      listEmployeeProfiles(db, actor),
      listTrainingModules(db),
      listTrainingAssignments(db),
      listQualityInspections(db, actor),
      listPayrollPeriods(db),
      listTimeOffRequests(db, actor),
    ]);
    return json({
      ok: true,
      profiles,
      modules,
      assignments,
      inspections,
      payroll: ['owner', 'finance'].includes(actor.role) ? payroll : [],
      timeOff,
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'employee_load_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 50);
    const actor = await requireActor(db, context.request, 'job.write');
    const payrollAction = action.startsWith('payroll_');
    if (payrollAction ? !['owner', 'finance'].includes(actor.role) : !['owner', 'manager'].includes(actor.role)) {
      return json({ ok: false, error: payrollAction ? 'finance_required' : 'manager_required' }, 403);
    }
    requireCsrf(context.request, actor);
    const directMemberId = text(body.teamMemberId, 100);
    if (directMemberId) await assertMemberScope(db, actor, directMemberId);
    if (action === 'update_profile') {
      await updateEmployeeProfile(db, actor, text(body.teamMemberId, 100), body);
      return json({ ok: true });
    }
    if (action === 'record_callout') {
      const teamMemberId = text(body.teamMemberId, 100);
      const appointmentId = text(body.appointmentId, 100);
      const reason = text(body.reason, 1000);
      const appointment = await db
        .prepare(
          `SELECT a.id, a.start_at, a.end_at, a.reference, a.branch_id, tm.display_name
           FROM appointments a
           JOIN appointment_resources ar ON ar.appointment_id = a.id
           JOIN team_members tm ON tm.id = ar.team_member_id
           WHERE a.id = ? AND ar.team_member_id = ? LIMIT 1`,
        )
        .bind(appointmentId, teamMemberId)
        .first<{
          id: string;
          start_at: string;
          end_at: string;
          reference: string;
          branch_id: string | null;
          display_name: string;
        }>();
      if (!appointment) throw new AdminAuthError(404, 'callout_assignment_not_found');
      await db
        .prepare(
          `INSERT INTO time_off_requests (id, team_member_id, start_at, end_at, reason, status, reviewed_by_admin_user_id, reviewed_at)
           VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)`,
        )
        .bind(
          `callout_${crypto.randomUUID()}`,
          teamMemberId,
          appointment.start_at,
          appointment.end_at,
          reason || 'Employee callout',
          actor.id,
          new Date().toISOString(),
        )
        .run();
      await db
        .prepare('INSERT INTO team_time_off (id, team_member_id, start_at, end_at, reason) VALUES (?, ?, ?, ?, ?)')
        .bind(
          `toff_${crypto.randomUUID()}`,
          teamMemberId,
          appointment.start_at,
          appointment.end_at,
          reason || 'Employee callout',
        )
        .run();
      await sendOperationalNotification(db, context.env as unknown as CommunicationEnv, {
        eventKey: 'employee_callout',
        subject: `Employee callout - ${appointment.display_name} - ${appointment.reference}`,
        text: [
          `Employee: ${appointment.display_name}`,
          `Reference: ${appointment.reference}`,
          `Scheduled: ${appointment.start_at} - ${appointment.end_at}`,
          `Reason: ${reason || 'not provided'}`,
          '',
          'Reassign the job or notify the customer.',
        ].join('\n'),
        relatedType: 'appointment',
        relatedId: appointmentId,
        ...(appointment.branch_id ? { branchId: appointment.branch_id } : {}),
        idempotencyKey: `employee-callout-${appointmentId}-${Date.now()}`,
      }).catch(() => undefined);
      await audit(db, {
        actorUserId: actor.id,
        action: 'employee.callout_recorded',
        entityType: 'appointment',
        entityId: appointmentId,
        detail: teamMemberId,
      });
      return json({ ok: true });
    }
    if (action === 'send_agreement') {
      return json({
        ok: true,
        ...(await createEmployeeAgreementRequest(db, actor, text(body.teamMemberId, 100), context.env)),
      });
    }
    if (action === 'handbook') {
      await acknowledgeHandbook(db, actor, text(body.teamMemberId, 100));
      return json({ ok: true });
    }
    if (action === 'add_onboarding') return json({ ok: true, ...(await addOnboardingTask(db, actor, body)) });
    if (action === 'onboarding_status') {
      const task = await db
        .prepare('SELECT team_member_id FROM employee_onboarding_tasks WHERE id = ? LIMIT 1')
        .bind(text(body.taskId, 100))
        .first<{ team_member_id: string }>();
      if (task) await assertMemberScope(db, actor, task.team_member_id);
      await setOnboardingStatus(db, actor, text(body.taskId, 100), text(body.status, 20));
      return json({ ok: true });
    }
    if (action === 'create_module') return json({ ok: true, ...(await createTrainingModule(db, actor, body)) });
    if (action === 'assign_training') {
      return json({
        ok: true,
        ...(await assignTraining(db, actor, {
          moduleId: text(body.moduleId, 100),
          teamMemberId: text(body.teamMemberId, 100),
        })),
      });
    }
    if (action === 'complete_training') {
      const assignment = await db
        .prepare('SELECT team_member_id FROM training_assignments WHERE id = ? LIMIT 1')
        .bind(text(body.assignmentId, 100))
        .first<{ team_member_id: string }>();
      if (assignment) await assertMemberScope(db, actor, assignment.team_member_id);
      await completeTraining(db, actor, text(body.assignmentId, 100), {
        ...(body.score !== undefined ? { score: Number(body.score) } : {}),
        ...(text(body.notes, 1000) ? { notes: text(body.notes, 1000) } : {}),
      });
      return json({ ok: true });
    }
    if (action === 'create_inspection') return json({ ok: true, ...(await createQualityInspection(db, actor, body)) });
    if (action === 'add_performance') return json({ ok: true, ...(await addPerformanceNote(db, actor, body)) });
    if (action === 'payroll_create') {
      return json({
        ok: true,
        ...(await createPayrollPeriod(db, actor, {
          periodStart: text(body.periodStart, 10),
          periodEnd: text(body.periodEnd, 10),
          ...(text(body.notes, 1000) ? { notes: text(body.notes, 1000) } : {}),
        })),
      });
    }
    if (action === 'payroll_calculate') {
      const result = await calculatePayrollPeriod(db, actor, text(body.periodId, 100));
      return json({ ok: true, ...result });
    }
    if (action === 'payroll_approve') {
      await approvePayrollPeriod(db, actor, text(body.periodId, 100));
      return json({ ok: true });
    }
    if (action === 'payroll_adjustment') {
      return json({
        ok: true,
        ...(await addPayrollAdjustment(db, actor, {
          periodId: text(body.periodId, 100),
          teamMemberId: text(body.teamMemberId, 100),
          kind: text(body.kind, 20),
          label: text(body.label, 200),
          amountCents: Math.round(Number(body.amountCents) || 0),
        })),
      });
    }
    if (action === 'set_shift') {
      return json({
        ok: true,
        ...(await setShiftOverride(db, actor, {
          teamMemberId: text(body.teamMemberId, 100),
          workDate: text(body.workDate, 10),
          startTime: text(body.startTime, 5),
          endTime: text(body.endTime, 5),
          available: body.available !== false,
          ...(text(body.note, 500) ? { note: text(body.note, 500) } : {}),
        })),
      });
    }
    if (action === 'time_off_review') {
      const request = await db
        .prepare('SELECT team_member_id FROM time_off_requests WHERE id = ? LIMIT 1')
        .bind(text(body.requestId, 100))
        .first<{ team_member_id: string }>();
      if (request) await assertMemberScope(db, actor, request.team_member_id);
      await reviewTimeOffRequest(
        db,
        actor,
        text(body.requestId, 100),
        body.status === 'approved' ? 'approved' : 'declined',
      );
      return json({ ok: true });
    }
    if (action === 'inspection_status') {
      const id = text(body.id, 100);
      if (actor.role !== 'owner') {
        const inspection = await db
          .prepare('SELECT branch_id FROM quality_inspections WHERE id = ? LIMIT 1')
          .bind(id)
          .first<{ branch_id: string | null }>();
        if (!inspection || !actor.branchId || inspection.branch_id !== actor.branchId) {
          return json({ ok: false, error: 'branch_scope_denied' }, 403);
        }
      }
      const status = ['draft', 'completed', 'follow_up'].includes(String(body.status))
        ? String(body.status)
        : 'completed';
      await db
        .prepare('UPDATE quality_inspections SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(status, id)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'employee.inspection_status',
        entityType: 'quality_inspection',
        entityId: id,
        detail: status,
      });
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'employee_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
