/**
 * Employee administration: profiles, onboarding, training, quality inspections
 * and performance records. Reuses team_members, appointments, customers and
 * properties rather than creating a second employee or job store.
 */
import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit, type AdminActor } from '../admin/operations.ts';

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function date(value: unknown): string {
  const result = text(value, 10);
  if (!result) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new AdminAuthError(400, 'date_invalid');
  return result;
}

function cents(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function scoped(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (!actor.branchId) return { sql: ' AND 1 = 0', bind: [] };
  return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
}

export async function listEmployeeProfiles(
  db: D1Database,
  actor: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const scope = scoped(actor, 't.branch_id');
  const rows = await db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM employee_onboarding_tasks o WHERE o.team_member_id = t.id AND o.status <> 'completed' AND o.required = 1) AS pending_onboarding,
              (SELECT COUNT(*) FROM training_assignments a WHERE a.team_member_id = t.id AND a.status = 'assigned') AS pending_training
       FROM team_members t WHERE 1 = 1${scope.sql}
       ORDER BY t.display_name`,
    )
    .bind(...scope.bind)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function updateEmployeeProfile(
  db: D1Database,
  actor: AdminActor,
  teamMemberId: string,
  input: Record<string, unknown>,
): Promise<void> {
  if (!['owner', 'manager'].includes(actor.role)) throw new AdminAuthError(403, 'admin_required');
  const existing = await db
    .prepare(`SELECT * FROM team_members WHERE id = ?${scoped(actor, 'branch_id').sql} LIMIT 1`)
    .bind(teamMemberId, ...scoped(actor, 'branch_id').bind)
    .first<Record<string, unknown>>();
  if (!existing) throw new AdminAuthError(404, 'employee_not_found');
  const status = input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : String(existing.status);
  const payRegular = cents(input.payRateRegular, Number(existing.pay_rate_regular_cents ?? 1800));
  const payLead = cents(input.payRateLead, Number(existing.pay_rate_lead_cents ?? 2200));
  const paySolo = cents(input.payRateSolo, Number(existing.pay_rate_solo_cents ?? 2500));
  const rateType = ['regular', 'lead', 'solo'].includes(String(input.defaultRateType))
    ? String(input.defaultRateType)
    : String(existing.default_rate_type ?? 'regular');
  const qualifications = Array.isArray(input.dispatchServices)
    ? input.dispatchServices.map((value) => text(value, 60)).filter(Boolean).slice(0, 20)
    : null;
  await db
    .prepare(
      `UPDATE team_members SET
         display_name = ?,
         email = ?,
         phone = ?,
         status = ?,
         is_bookable = ?,
         emergency_contact_name = ?,
         emergency_contact_phone = ?,
         hire_date = ?,
         personnel_notes = ?,
         license_expires_on = ?,
         work_authorization_expires_on = ?,
         pay_rate_regular_cents = ?,
         pay_rate_lead_cents = ?,
         pay_rate_solo_cents = ?,
         default_rate_type = ?,
         updated_at = CURRENT_TIMESTAMP
         ${qualifications ? ', dispatch_services_json = ?' : ''}
       WHERE id = ?`,
    )
    .bind(
      text(input.displayName, 160) || String(existing.display_name),
      text(input.email, 200).toLowerCase() || String(existing.email),
      text(input.phone, 40),
      status,
      input.isBookable === false ? 0 : 1,
      text(input.emergencyContactName, 160),
      text(input.emergencyContactPhone, 40),
      date(input.hireDate) || null,
      text(input.personnelNotes, 4000),
      date(input.licenseExpiresOn) || null,
      date(input.workAuthorizationExpiresOn) || null,
      payRegular,
      payLead,
      paySolo,
      rateType,
      ...(qualifications ? [JSON.stringify(qualifications)] : []),
      teamMemberId,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'employee.profile_updated',
    entityType: 'team_member',
    entityId: teamMemberId,
  });
}

export async function acknowledgeHandbook(
  db: D1Database,
  actor: AdminActor,
  teamMemberId: string,
): Promise<void> {
  const employee = await db
    .prepare('SELECT id FROM team_members WHERE id = ? LIMIT 1')
    .bind(teamMemberId)
    .first();
  if (!employee) throw new AdminAuthError(404, 'employee_not_found');
  await db
    .prepare(
      'UPDATE team_members SET handbook_acknowledged_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    )
    .bind(new Date().toISOString(), teamMemberId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'employee.handbook_acknowledged',
    entityType: 'team_member',
    entityId: teamMemberId,
  });
}

export async function listOnboarding(
  db: D1Database,
  teamMemberId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      'SELECT * FROM employee_onboarding_tasks WHERE team_member_id = ? ORDER BY required DESC, created_at',
    )
    .bind(teamMemberId)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function addOnboardingTask(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const teamMemberId = text(input.teamMemberId, 100);
  const title = text(input.title, 200);
  if (!teamMemberId || !title) throw new AdminAuthError(400, 'onboarding_fields_required');
  const id = `onb_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO employee_onboarding_tasks
       (id, team_member_id, title, category, required, due_date, notes, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      teamMemberId,
      title,
      text(input.category, 80) || 'general',
      input.required === false ? 0 : 1,
      date(input.dueDate) || null,
      text(input.notes, 1000),
      actor.id,
    )
    .run();
  return { id };
}

export async function setOnboardingStatus(
  db: D1Database,
  actor: AdminActor,
  taskId: string,
  status: string,
): Promise<void> {
  const target = ['pending', 'completed', 'waived'].includes(status) ? status : '';
  if (!target) throw new AdminAuthError(400, 'onboarding_status_invalid');
  await db
    .prepare(
      'UPDATE employee_onboarding_tasks SET status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    )
    .bind(target, target === 'completed' ? new Date().toISOString() : null, taskId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'employee.onboarding_status',
    entityType: 'employee_onboarding_task',
    entityId: taskId,
    detail: target,
  });
}

export async function listTrainingModules(db: D1Database): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare('SELECT * FROM training_modules ORDER BY active DESC, category, title')
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function createTrainingModule(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const title = text(input.title, 200);
  if (!title) throw new AdminAuthError(400, 'training_title_required');
  const id = `train_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO training_modules
       (id, title, category, content_text, assessment_json, version, required, active, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(
      id,
      title,
      text(input.category, 80) || 'general',
      text(input.contentText, 20000),
      JSON.stringify(Array.isArray(input.assessment) ? input.assessment.slice(0, 30) : []),
      text(input.version, 40) || '1.0',
      input.required === false ? 0 : 1,
      actor.id,
    )
    .run();
  return { id };
}

export async function assignTraining(
  db: D1Database,
  actor: AdminActor,
  input: { moduleId: string; teamMemberId: string },
): Promise<{ id: string }> {
  const id = `tassign_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO training_assignments
       (id, module_id, team_member_id, assigned_by_admin_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(module_id, team_member_id) DO UPDATE SET status = 'assigned', assigned_at = CURRENT_TIMESTAMP`,
    )
    .bind(id, input.moduleId, input.teamMemberId, actor.id)
    .run();
  return { id };
}

export async function completeTraining(
  db: D1Database,
  actor: AdminActor,
  assignmentId: string,
  input: { score?: number; notes?: string },
): Promise<void> {
  const assignment = await db
    .prepare('SELECT * FROM training_assignments WHERE id = ? LIMIT 1')
    .bind(assignmentId)
    .first<Record<string, unknown>>();
  if (!assignment) throw new AdminAuthError(404, 'training_assignment_not_found');
  await db
    .prepare(
      `UPDATE training_assignments SET status = 'completed', completed_at = ?, score = ?, notes = ?
       WHERE id = ?`,
    )
    .bind(
      new Date().toISOString(),
      Number.isFinite(Number(input.score)) ? Math.round(Number(input.score)) : null,
      text(input.notes, 1000),
      assignmentId,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'employee.training_completed',
    entityType: 'training_assignment',
    entityId: assignmentId,
  });
}

export async function listTrainingAssignments(
  db: D1Database,
  teamMemberId?: string,
): Promise<Array<Record<string, unknown>>> {
  const where = teamMemberId ? 'WHERE a.team_member_id = ?' : '';
  const rows = await db
    .prepare(
      `SELECT a.*, m.title, m.category, tm.display_name
       FROM training_assignments a
       JOIN training_modules m ON m.id = a.module_id
       JOIN team_members tm ON tm.id = a.team_member_id
       ${where}
       ORDER BY a.status, a.assigned_at DESC LIMIT 300`,
    )
    .bind(...(teamMemberId ? [teamMemberId] : []))
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function listQualityInspections(
  db: D1Database,
  actor: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const scope = scoped(actor, 'q.branch_id');
  const rows = await db
    .prepare(
      `SELECT q.*, c.first_name, c.last_name, c.company_name, tm.display_name AS inspector_name
       FROM quality_inspections q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN team_members tm ON tm.id = q.inspector_team_member_id
       WHERE 1 = 1${scope.sql}
       ORDER BY q.inspected_at DESC LIMIT 200`,
    )
    .bind(...scope.bind)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function createQualityInspection(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const inspectedAt = date(input.inspectedAt) || new Date().toISOString().slice(0, 10);
  const appointmentId = text(input.appointmentId, 100);
  let customerId = text(input.customerId, 100);
  let propertyId = text(input.propertyId, 100);
  let branchId: string | null = actor.branchId ?? null;
  if (appointmentId) {
    const appointment = await db
      .prepare('SELECT customer_id, property_id, branch_id FROM appointments WHERE id = ? LIMIT 1')
      .bind(appointmentId)
      .first<{ customer_id: string; property_id: string | null; branch_id: string | null }>();
    if (!appointment) throw new AdminAuthError(404, 'appointment_not_found');
    if (actor.role !== 'owner' && actor.branchId && appointment.branch_id !== actor.branchId) {
      throw new AdminAuthError(403, 'branch_scope_denied');
    }
    customerId = appointment.customer_id;
    propertyId = appointment.property_id ?? '';
    branchId = appointment.branch_id;
  }
  const score = Number(input.score);
  const id = `quality_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO quality_inspections
       (id, branch_id, appointment_id, customer_id, property_id, inspector_team_member_id,
        inspected_at, score, checklist_json, findings, corrective_actions, status, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      branchId,
      appointmentId || null,
      customerId || null,
      propertyId || null,
      text(input.inspectorTeamMemberId, 100) || null,
      inspectedAt,
      Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null,
      JSON.stringify(Array.isArray(input.checklist) ? input.checklist.slice(0, 100) : []),
      text(input.findings, 4000),
      text(input.correctiveActions, 4000),
      ['draft', 'completed', 'follow_up'].includes(String(input.status)) ? String(input.status) : 'completed',
      actor.id,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'employee.quality_inspection_created',
    entityType: 'quality_inspection',
    entityId: id,
    detail: appointmentId,
  });
  return { id };
}

export async function addPerformanceNote(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const teamMemberId = text(input.teamMemberId, 100);
  const note = text(input.note, 4000);
  if (!teamMemberId || !note) throw new AdminAuthError(400, 'performance_note_required');
  const kind = ['praise', 'coaching', 'corrective', 'customer_feedback', 'review'].includes(String(input.kind))
    ? String(input.kind)
    : 'coaching';
  const id = `perf_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO employee_performance_notes
       (id, team_member_id, kind, note, appointment_id, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, teamMemberId, kind, note, text(input.appointmentId, 100) || null, actor.id)
    .run();
  return { id };
}

export async function listPerformanceNotes(
  db: D1Database,
  teamMemberId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      `SELECT p.*, tm.display_name FROM employee_performance_notes p
       JOIN team_members tm ON tm.id = p.team_member_id
       WHERE p.team_member_id = ? ORDER BY p.created_at DESC LIMIT 200`,
    )
    .bind(teamMemberId)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function employeeDocumentExpirations(
  db: D1Database,
  teamMemberId: string,
): Promise<Array<Record<string, unknown>>> {
  const employee = await db
    .prepare(
      'SELECT license_expires_on, work_authorization_expires_on, hire_date FROM team_members WHERE id = ? LIMIT 1',
    )
    .bind(teamMemberId)
    .first<Record<string, unknown>>();
  if (!employee) throw new AdminAuthError(404, 'employee_not_found');
  const documents = await db
    .prepare(
      `SELECT id, packet_name, bundle_code, status, created_at FROM signing_requests
       WHERE team_member_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(teamMemberId)
    .all<Record<string, unknown>>();
  return [
    ...(employee.license_expires_on
      ? [{ label: 'License / certification', expires: employee.license_expires_on }]
      : []),
    ...(employee.work_authorization_expires_on
      ? [{ label: 'Work authorization', expires: employee.work_authorization_expires_on }]
      : []),
    ...(documents.results ?? []).map((document) => ({
      label: String(document.packet_name ?? document.bundle_code ?? 'Employee document'),
      status: document.status,
      created: document.created_at,
    })),
  ];
}

export async function listTimeOffRequests(
  db: D1Database,
  actor: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const scope = scoped(actor, 't.branch_id');
  const rows = await db
    .prepare(
      `SELECT r.*, t.display_name FROM time_off_requests r
       JOIN team_members t ON t.id = r.team_member_id
       WHERE 1 = 1${scope.sql}
       ORDER BY r.created_at DESC LIMIT 200`,
    )
    .bind(...scope.bind)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function reviewTimeOffRequest(
  db: D1Database,
  actor: AdminActor,
  requestId: string,
  status: 'approved' | 'declined',
): Promise<void> {
  const request = await db
    .prepare('SELECT * FROM time_off_requests WHERE id = ? LIMIT 1')
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!request) throw new AdminAuthError(404, 'time_off_request_not_found');
  await db
    .prepare(
      'UPDATE time_off_requests SET status = ?, reviewed_by_admin_user_id = ?, reviewed_at = ? WHERE id = ?',
    )
    .bind(status, actor.id, new Date().toISOString(), requestId)
    .run();
  if (status === 'approved') {
    await db
      .prepare(
        `INSERT INTO team_time_off (id, team_member_id, start_at, end_at, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        `toff_${crypto.randomUUID()}`,
        request.team_member_id,
        request.start_at,
        request.end_at,
        String(request.reason ?? ''),
      )
      .run();
  }
  await audit(db, {
    actorUserId: actor.id,
    action: 'employee.time_off_reviewed',
    entityType: 'time_off_request',
    entityId: requestId,
    detail: status,
  });
}


export async function listShiftOverrides(
  db: D1Database,
  teamMemberId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      `SELECT id, work_date, start_time, end_time, available, note
       FROM dispatch_shift_overrides WHERE team_member_id = ?
       ORDER BY work_date DESC LIMIT 100`,
    )
    .bind(teamMemberId)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function setShiftOverride(
  db: D1Database,
  actor: AdminActor,
  input: { teamMemberId: string; workDate: string; startTime: string; endTime: string; available: boolean; note?: string },
): Promise<{ id: string }> {
  const start = input.startTime.trim();
  const end = input.endTime.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) {
    throw new AdminAuthError(400, 'shift_fields_invalid');
  }
  const id = `shift_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO dispatch_shift_overrides
       (id, team_member_id, work_date, start_time, end_time, available, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_member_id, work_date) DO UPDATE SET
         start_time = excluded.start_time, end_time = excluded.end_time,
         available = excluded.available, note = excluded.note`,
    )
    .bind(
      id,
      input.teamMemberId,
      input.workDate,
      start,
      end,
      input.available ? 1 : 0,
      String(input.note ?? '').slice(0, 500),
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'employee.shift_override_saved',
    entityType: 'team_member',
    entityId: input.teamMemberId,
    detail: input.workDate,
  });
  return { id };
}
