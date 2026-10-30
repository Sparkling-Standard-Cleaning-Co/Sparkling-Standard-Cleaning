import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import type { D1Database } from './d1.ts';

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function scope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

function branchFor(actor: AdminActor, requested: unknown): string | null {
  if (actor.role !== 'owner') return actor.branchId;
  return text(requested, 80) || null;
}

function validIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));
}

function uuid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function listRequests(
  db: D1Database,
  actor: AdminActor,
  status = 'pending',
): Promise<Array<Record<string, unknown>>> {
  const branch = scope(actor, 'r.branch_id');
  const result = await db
    .prepare(
      `SELECT r.*, c.first_name, c.last_name, p.line1, p.city, p.state, p.postal_code
       FROM booking_requests r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN properties p ON p.id = r.property_id
       WHERE (? = '' OR r.status = ?) ${branch.sql}
       ORDER BY r.start_at ASC LIMIT 200`,
    )
    .bind(text(status, 20), text(status, 20), ...branch.bind)
    .all();
  return result.results ?? [];
}

export async function listAppointments(
  db: D1Database,
  actor: AdminActor,
  input: { from?: string; to?: string; status?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const branch = scope(actor, 'a.branch_id');
  const from = validIso(input.from ?? '') ? input.from! : '1970-01-01T00:00';
  const to = validIso(input.to ?? '') ? input.to! : '2999-12-31T23:59';
  const status = text(input.status, 20);
  const result = await db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name, p.line1, p.city, p.state, p.postal_code,
              (SELECT GROUP_CONCAT(tm.display_name, ', ') FROM appointment_resources ar
               JOIN team_members tm ON tm.id = ar.team_member_id WHERE ar.appointment_id = a.id) AS crew
       FROM appointments a
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN properties p ON p.id = a.property_id
       WHERE a.start_at >= ? AND a.start_at <= ? AND (? = '' OR a.status = ?) ${branch.sql}
       ORDER BY a.start_at ASC LIMIT 300`,
    )
    .bind(from, to, status, status, ...branch.bind)
    .all();
  return result.results ?? [];
}

async function assertNoOverlap(
  db: D1Database,
  branchId: string | null,
  startAt: string,
  endAt: string,
  excludeAppointmentId = '',
): Promise<void> {
  const conflict = await db
    .prepare(
      `SELECT id FROM appointments
       WHERE status IN ('pending','confirmed','in_progress')
         AND id <> ? AND start_at < ? AND end_at > ?
         AND (? IS NULL OR branch_id = ?)
       LIMIT 1`,
    )
    .bind(excludeAppointmentId, endAt, startAt, branchId, branchId)
    .first<{ id: string }>();
  if (conflict) throw new AdminAuthError(409, 'schedule_conflict');
}

export async function confirmRequest(
  db: D1Database,
  actor: AdminActor,
  requestId: string,
  teamMemberIds: string[] = [],
): Promise<{ appointmentId: string; reference: string }> {
  const row = await db
    .prepare(
      `SELECT r.*, a.id AS existing_appointment FROM booking_requests r
       LEFT JOIN appointments a ON a.booking_request_id = r.id
       WHERE r.id = ? ${scope(actor, 'r.branch_id').sql} LIMIT 1`,
    )
    .bind(requestId, ...scope(actor, 'r.branch_id').bind)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'request_not_found');
  if (row.existing_appointment) throw new AdminAuthError(409, 'request_already_confirmed');
  if (!row.customer_id || !row.property_id) throw new AdminAuthError(400, 'request_customer_incomplete');
  const startAt = String(row.start_at ?? '');
  const endAt = String(row.end_at ?? '');
  const branchId = (row.branch_id as string | null) ?? actor.branchId;
  await assertNoOverlap(db, branchId, startAt, endAt);
  const appointmentId = uuid('appt');
  const reference = `APT-${Date.now().toString(36).toUpperCase()}`;
  await db
    .prepare(
      `INSERT INTO appointments
       (id, branch_id, customer_id, property_id, booking_request_id, status, start_at, end_at,
        duration_minutes, crew_size, source, reference)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, 'admin', ?)`,
    )
    .bind(
      appointmentId,
      branchId,
      row.customer_id,
      row.property_id,
      requestId,
      startAt,
      endAt,
      Number(row.duration_minutes) || 120,
      Math.max(1, teamMemberIds.length),
      reference,
    )
    .run();
  await db
    .prepare("UPDATE booking_requests SET status = 'confirmed', updated_at = ? WHERE id = ?")
    .bind(now(), requestId)
    .run();
  await db
    .prepare("UPDATE booking_holds SET status = 'confirmed' WHERE request_id = ?")
    .bind(requestId)
    .run();
  if (teamMemberIds.length > 0) await assignTeam(db, actor, appointmentId, teamMemberIds);
  await audit(db, { actorUserId: actor.id, action: 'booking.confirmed', entityType: 'appointment', entityId: appointmentId });
  return { appointmentId, reference };
}

export async function updateRequestStatus(
  db: D1Database,
  actor: AdminActor,
  requestId: string,
  status: string,
): Promise<void> {
  if (!['pending', 'declined', 'released', 'expired'].includes(status)) {
    throw new AdminAuthError(400, 'request_status_invalid');
  }
  const result = await db
    .prepare(`UPDATE booking_requests SET status = ?, updated_at = ? WHERE id = ? ${scope(actor, 'branch_id').sql}`)
    .bind(status, now(), requestId, ...scope(actor, 'branch_id').bind)
    .run();
  if (!result.success) throw new AdminAuthError(400, 'request_update_failed');
  await audit(db, { actorUserId: actor.id, action: `booking.${status}`, entityType: 'booking_request', entityId: requestId });
}

export async function listRecurring(
  db: D1Database,
  actor: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const branch = scope(actor, 'r.branch_id');
  const result = await db
    .prepare(
      `SELECT r.*, c.first_name, c.last_name, p.line1, p.city
       FROM recurring_plans r JOIN customers c ON c.id = r.customer_id
       JOIN properties p ON p.id = r.property_id
       WHERE 1 = 1 ${branch.sql} ORDER BY r.next_visit_date ASC LIMIT 200`,
    )
    .bind(...branch.bind)
    .all();
  return result.results ?? [];
}

function nextDate(startDate: string, frequency: string): string {
  const parts = startDate.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === 'biweekly') date.setUTCDate(date.getUTCDate() + 14);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

export async function createRecurring(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const customerId = text(input.customerId, 100);
  const propertyId = text(input.propertyId, 100);
  const frequency = text(input.frequency, 20);
  const startDate = text(input.startDate, 10);
  if (!customerId || !propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new AdminAuthError(400, 'recurring_fields_required');
  }
  const customerScope = scope(actor, 'c.primary_branch_id');
  const ownership = await db
    .prepare(
      `SELECT c.id AS customer_id, p.id AS property_id, c.primary_branch_id FROM customers c
       JOIN properties p ON p.customer_id = c.id AND p.status = 'active'
       WHERE c.id = ? AND p.id = ? ${customerScope.sql} LIMIT 1`,
    )
    .bind(customerId, propertyId, ...customerScope.bind)
    .first<{ customer_id: string; property_id: string; primary_branch_id: string | null }>();
  if (!ownership) throw new AdminAuthError(404, 'customer_property_not_found');
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) throw new AdminAuthError(400, 'frequency_invalid');
  const branchId = branchFor(actor, input.branchId) ?? ownership.primary_branch_id;
  const id = uuid('rec');
  const price = Math.max(0, Math.round(Number(input.ongoingPrice) * 100) || 0);
  await db
    .prepare(
      `INSERT INTO recurring_plans
       (id, customer_id, property_id, branch_id, service_code, frequency, status, ongoing_price_cents, start_date, next_visit_date, terms_version)
       VALUES (?, ?, ?, ?, 'residential-cleaning', ?, 'active', ?, ?, ?, ?)`,
    )
    .bind(id, customerId, propertyId, branchId, frequency, price, startDate, startDate, text(input.termsVersion, 80) || 'admin.v1')
    .run();
  await audit(db, { actorUserId: actor.id, action: 'recurring.created', entityType: 'recurring_plan', entityId: id });
  return { id };
}

export async function updateRecurring(
  db: D1Database,
  actor: AdminActor,
  planId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const current = await db
    .prepare(`SELECT * FROM recurring_plans WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(planId, ...scope(actor, 'branch_id').bind)
    .first<Record<string, unknown>>();
  if (!current) throw new AdminAuthError(404, 'recurring_not_found');
  const status = text(input.status, 20) || String(current.status ?? 'active');
  if (!['active', 'paused', 'cancelled', 'completed'].includes(status)) throw new AdminAuthError(400, 'status_invalid');
  const frequency = text(input.frequency, 20) || String(current.frequency ?? 'biweekly');
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) throw new AdminAuthError(400, 'frequency_invalid');
  const startDate = text(input.startDate, 10) || String(current.start_date ?? '').slice(0, 10);
  const nextVisit = status === 'active' ? text(input.nextVisitDate, 10) || nextDate(startDate, frequency) : null;
  await db
    .prepare(
      `UPDATE recurring_plans SET frequency = ?, status = ?, ongoing_price_cents = ?, start_date = ?, next_visit_date = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(frequency, status, Math.max(0, Math.round(Number(input.ongoingPrice ?? Number(current.ongoing_price_cents) / 100) * 100) || 0), startDate, nextVisit, now(), planId)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'recurring.updated', entityType: 'recurring_plan', entityId: planId, detail: status });
}

export async function listTeam(
  db: D1Database,
  actor: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const branch = scope(actor, 'branch_id');
  const result = await db
    .prepare(`SELECT * FROM team_members WHERE 1 = 1 ${branch.sql} ORDER BY display_name`)
    .bind(...branch.bind)
    .all();
  return result.results ?? [];
}

export async function createTeamMember(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const name = text(input.displayName, 120);
  if (!name) throw new AdminAuthError(400, 'team_name_required');
  const id = uuid('team');
  await db
    .prepare(
      `INSERT INTO team_members (id, branch_id, display_name, email, phone, status, is_bookable)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, branchFor(actor, input.branchId), name, text(input.email, 200), text(input.phone, 30), input.status === 'inactive' ? 'inactive' : 'active', input.isBookable === false ? 0 : 1)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'team.created', entityType: 'team_member', entityId: id });
  return { id };
}

export async function updateTeamMember(
  db: D1Database,
  actor: AdminActor,
  memberId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const current = await db
    .prepare(`SELECT * FROM team_members WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(memberId, ...scope(actor, 'branch_id').bind)
    .first<Record<string, unknown>>();
  if (!current) throw new AdminAuthError(404, 'team_not_found');
  await db
    .prepare(`UPDATE team_members SET display_name = ?, email = ?, phone = ?, status = ?, is_bookable = ?, updated_at = ? WHERE id = ?`)
    .bind(text(input.displayName, 120) || current.display_name, text(input.email, 200), text(input.phone, 30), input.status === 'inactive' ? 'inactive' : 'active', input.isBookable === false ? 0 : 1, now(), memberId)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'team.updated', entityType: 'team_member', entityId: memberId });
}

export async function assignTeam(
  db: D1Database,
  actor: AdminActor,
  appointmentId: string,
  memberIds: string[],
): Promise<void> {
  const appointment = await db
    .prepare(`SELECT * FROM appointments WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(appointmentId, ...scope(actor, 'branch_id').bind)
    .first<Record<string, unknown>>();
  if (!appointment) throw new AdminAuthError(404, 'appointment_not_found');
  for (const memberId of [...new Set(memberIds)]) {
    const member = await db
      .prepare(`SELECT * FROM team_members WHERE id = ? AND status = 'active' AND is_bookable = 1 ${scope(actor, 'branch_id').sql} LIMIT 1`)
      .bind(memberId, ...scope(actor, 'branch_id').bind)
      .first<Record<string, unknown>>();
    if (!member) throw new AdminAuthError(400, 'team_member_invalid');
    const conflict = await db
      .prepare(
        `SELECT ar.appointment_id FROM appointment_resources ar
         JOIN appointments a ON a.id = ar.appointment_id
         WHERE ar.team_member_id = ? AND a.id <> ? AND a.status IN ('pending','confirmed','in_progress')
           AND a.start_at < ? AND a.end_at > ? LIMIT 1`,
      )
      .bind(memberId, appointmentId, appointment.end_at, appointment.start_at)
      .first();
    if (conflict) throw new AdminAuthError(409, 'team_conflict');
    await db
      .prepare('INSERT OR IGNORE INTO appointment_resources (appointment_id, team_member_id, role) VALUES (?, ?, ?)')
      .bind(appointmentId, memberId, 'cleaner')
      .run();
  }
  await db
    .prepare('UPDATE appointments SET crew_size = (SELECT COUNT(*) FROM appointment_resources WHERE appointment_id = ?), updated_at = ? WHERE id = ?')
    .bind(appointmentId, now(), appointmentId)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'job.team_assigned', entityType: 'appointment', entityId: appointmentId });
}

export async function updateAppointmentStatus(
  db: D1Database,
  actor: AdminActor,
  appointmentId: string,
  status: string,
): Promise<void> {
  if (!['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].includes(status)) {
    throw new AdminAuthError(400, 'job_status_invalid');
  }
  const result = await db
    .prepare(`UPDATE appointments SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ? ${scope(actor, 'branch_id').sql}`)
    .bind(status, status === 'cancelled' ? now() : null, now(), appointmentId, ...scope(actor, 'branch_id').bind)
    .run();
  if (!result.success) throw new AdminAuthError(400, 'job_update_failed');
  await audit(db, { actorUserId: actor.id, action: `job.${status}`, entityType: 'appointment', entityId: appointmentId });
}

const CHECKLIST_TEMPLATE = [
  'Dust all reachable surfaces',
  'Clean and sanitize bathrooms',
  'Clean kitchen counters and sink',
  'Vacuum carpets and rugs',
  'Mop hard floors',
  'Empty trash and replace liners',
  'Final walkthrough',
];

export async function createChecklist(
  db: D1Database,
  actor: AdminActor,
  appointmentId: string,
): Promise<{ id: string }> {
  const appointment = await db
    .prepare(`SELECT id FROM appointments WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(appointmentId, ...scope(actor, 'branch_id').bind)
    .first();
  if (!appointment) throw new AdminAuthError(404, 'appointment_not_found');
  const existing = await db
    .prepare('SELECT id FROM job_checklists WHERE appointment_id = ? LIMIT 1')
    .bind(appointmentId)
    .first<{ id: string }>();
  if (existing) return { id: existing.id };
  const id = uuid('checklist');
  await db
    .prepare("INSERT INTO job_checklists (id, appointment_id, template_id, status) VALUES (?, ?, 'residential-standard.v1', 'pending')")
    .bind(id, appointmentId)
    .run();
  for (const [index, label] of CHECKLIST_TEMPLATE.entries()) {
    await db
      .prepare('INSERT INTO job_checklist_items (id, checklist_id, label, sort_order) VALUES (?, ?, ?, ?)')
      .bind(uuid('check'), id, label, index)
      .run();
  }
  await audit(db, { actorUserId: actor.id, action: 'job.checklist_created', entityType: 'appointment', entityId: appointmentId });
  return { id };
}

export async function getChecklist(
  db: D1Database,
  actor: AdminActor,
  appointmentId: string,
): Promise<Record<string, unknown> | null> {
  const appointment = await db
    .prepare(`SELECT id FROM appointments WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(appointmentId, ...scope(actor, 'branch_id').bind)
    .first();
  if (!appointment) throw new AdminAuthError(404, 'appointment_not_found');
  const checklist = await db
    .prepare('SELECT * FROM job_checklists WHERE appointment_id = ? LIMIT 1')
    .bind(appointmentId)
    .first<Record<string, unknown>>();
  if (!checklist) return null;
  const items = await db
    .prepare('SELECT * FROM job_checklist_items WHERE checklist_id = ? ORDER BY sort_order')
    .bind(checklist.id)
    .all();
  return { checklist, items: items.results ?? [] };
}

export async function updateChecklistItem(
  db: D1Database,
  actor: AdminActor,
  itemId: string,
  completed: boolean,
  notes = '',
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT i.id, c.id AS checklist_id, a.id AS appointment_id
       FROM job_checklist_items i JOIN job_checklists c ON c.id = i.checklist_id
       JOIN appointments a ON a.id = c.appointment_id
       WHERE i.id = ? ${scope(actor, 'a.branch_id').sql} LIMIT 1`,
    )
    .bind(itemId, ...scope(actor, 'a.branch_id').bind)
    .first<{ id: string; checklist_id: string; appointment_id: string }>();
  if (!row) throw new AdminAuthError(404, 'checklist_item_not_found');
  await db
    .prepare('UPDATE job_checklist_items SET completed = ?, completed_at = ?, notes = ? WHERE id = ?')
    .bind(completed ? 1 : 0, completed ? now() : null, text(notes, 1000), itemId)
    .run();
  const remaining = await db
    .prepare('SELECT COUNT(*) AS count FROM job_checklist_items WHERE checklist_id = ? AND completed = 0')
    .bind(row.checklist_id)
    .first<{ count: number }>();
  const done = Number(remaining?.count ?? 0) === 0;
  await db
    .prepare("UPDATE job_checklists SET status = ?, completed_at = ? WHERE id = ?")
    .bind(done ? 'completed' : 'in_progress', done ? now() : null, row.checklist_id)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'job.checklist_item_updated', entityType: 'job_checklist_item', entityId: itemId });
}
