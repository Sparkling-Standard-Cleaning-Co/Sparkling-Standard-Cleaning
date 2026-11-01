import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import type { D1Database } from './d1.ts';
import { bookingConfig } from '../../config/booking.ts';
import { employeeOnboardingStatus, evaluateDocumentGate } from '../documents/service.ts';

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
               JOIN team_members tm ON tm.id = ar.team_member_id WHERE ar.appointment_id = a.id) AS crew,
              (SELECT GROUP_CONCAT(ar.team_member_id) FROM appointment_resources ar
               WHERE ar.appointment_id = a.id) AS crew_ids,
              (SELECT provider_event_id FROM calendar_links cl WHERE cl.appointment_id = a.id
               ORDER BY cl.last_synced_at DESC LIMIT 1) AS calendar_event_id
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

/**
 * Finds a qualified, available crew for the requested interval. Capacity is
 * per employee, not per branch: two independent anchors may work at the same
 * time, while a helper never creates an independent slot.
 */
export async function selectAvailableCrew(
  db: D1Database,
  branchId: string | null,
  startAt: string,
  endAt: string,
  crewSize: number,
  excludeAppointmentId = '',
): Promise<string[]> {
  const members = await db
    .prepare(
      `SELECT tm.id, tm.is_solo, tm.is_lead
       FROM team_members tm
       WHERE tm.status = 'active' AND tm.is_bookable = 1 AND tm.booking_resource_id <> ''
         AND (tm.is_solo = 1 OR tm.is_lead = 1)
         AND (? IS NULL OR tm.branch_id IS NULL OR tm.branch_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM appointment_resources ar
           JOIN appointments a ON a.id = ar.appointment_id
           WHERE ar.team_member_id = tm.id
             AND a.id <> ? AND a.status IN ('pending','confirmed','in_progress')
             AND a.start_at < ? AND a.end_at > ?
         )
       ORDER BY tm.is_solo DESC, tm.is_lead DESC, tm.display_name`,
    )
    .bind(branchId, branchId, excludeAppointmentId, endAt, startAt)
    .all<{ id: string; is_solo: number; is_lead: number }>();
  const available = members.results ?? [];
  const wanted = Math.max(1, Math.min(bookingConfig.maxCrewSize, Math.round(crewSize)));
  if (available.length < wanted) throw new AdminAuthError(409, 'schedule_conflict');
  return available.slice(0, wanted).map((member) => member.id);
}

async function assertNoOverlap(
  db: D1Database,
  branchId: string | null,
  startAt: string,
  endAt: string,
  excludeAppointmentId = '',
  crewSize = 1,
  teamMemberIds: string[] = [],
): Promise<string[]> {
  if (teamMemberIds.length > 0) {
    const unique = [...new Set(teamMemberIds)];
    if (unique.length !== teamMemberIds.length) throw new AdminAuthError(400, 'team_duplicate');
    for (const memberId of unique) {
      const member = await db
        .prepare(
          `SELECT id, is_solo, is_lead FROM team_members
           WHERE id = ? AND status = 'active' AND is_bookable = 1`,
        )
        .bind(memberId)
        .first<{ id: string; is_solo: number; is_lead: number }>();
      if (!member) throw new AdminAuthError(400, 'team_member_invalid');
      const conflict = await db
        .prepare(
          `SELECT ar.appointment_id FROM appointment_resources ar
           JOIN appointments a ON a.id = ar.appointment_id
           WHERE ar.team_member_id = ? AND a.id <> ?
             AND a.status IN ('pending','confirmed','in_progress')
             AND a.start_at < ? AND a.end_at > ? LIMIT 1`,
        )
        .bind(memberId, excludeAppointmentId, endAt, startAt)
        .first();
      if (conflict) throw new AdminAuthError(409, 'team_conflict');
    }
    const anchors = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM team_members
         WHERE id IN (${unique.map(() => '?').join(',')})
           AND (is_solo = 1 OR is_lead = 1)`,
      )
      .bind(...unique)
      .first<{ count: number }>();
    if (Number(anchors?.count ?? 0) < 1) throw new AdminAuthError(409, 'crew_requires_lead');
    return unique;
  }
  return selectAvailableCrew(db, branchId, startAt, endAt, crewSize, excludeAppointmentId);
}

export async function assertRequestConfirmable(
  db: D1Database,
  actor: AdminActor,
  requestId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT r.status, r.customer_id, r.property_id, r.start_at, r.end_at, r.branch_id,
              r.payload_json, r.quote_reference, a.id AS existing_appointment
       FROM booking_requests r
       LEFT JOIN appointments a ON a.booking_request_id = r.id
       WHERE r.id = ? ${scope(actor, 'r.branch_id').sql} LIMIT 1`,
    )
    .bind(requestId, ...scope(actor, 'r.branch_id').bind)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'request_not_found');
  if (row.existing_appointment) throw new AdminAuthError(409, 'request_already_confirmed');
  if (!row.customer_id || !row.property_id) throw new AdminAuthError(400, 'request_customer_incomplete');
  const payload = parsePayload(row.payload_json);
  const gate = await evaluateDocumentGate(
    db,
    {
      subjectType: 'customer',
      customerId: String(row.customer_id),
      propertyId: String(row.property_id),
      serviceCode: payload.service_type || payload.service_code || 'residential-cleaning',
      frequency: payload.frequency || payload.ongoing_frequency || '',
      bookingReference: String(row.quote_reference ?? ''),
      bookingRequestId: requestId,
      accessAuthorization: payload.access_authorization === 'yes',
      customerProducts: payload.customer_products === 'yes',
    },
    'before_confirmation',
  );
  if (!gate.satisfied) throw new AdminAuthError(409, 'documents_required');
  await assertNoOverlap(
    db,
    (row.branch_id as string | null) ?? actor.branchId,
    String(row.start_at ?? ''),
    String(row.end_at ?? ''),
    '',
    1,
  );
}

function parsePayload(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) => typeof entry === 'string'),
    ) as Record<string, string>;
  } catch {
    return {};
  }
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
  const payload = parsePayload(row.payload_json);
  const gate = await evaluateDocumentGate(
    db,
    {
      subjectType: 'customer',
      customerId: String(row.customer_id),
      propertyId: String(row.property_id),
      serviceCode: payload.service_type || payload.service_code || 'residential-cleaning',
      frequency: payload.frequency || payload.ongoing_frequency || '',
      bookingReference: String(row.quote_reference ?? ''),
      bookingRequestId: requestId,
      accessAuthorization: payload.access_authorization === 'yes',
      customerProducts: payload.customer_products === 'yes',
    },
    'before_confirmation',
  );
  if (!gate.satisfied) throw new AdminAuthError(409, 'documents_required');
  const startAt = String(row.start_at ?? '');
  const endAt = String(row.end_at ?? '');
  const branchId = (row.branch_id as string | null) ?? actor.branchId;
  const requestedCrew = Math.max(1, teamMemberIds.length);
  const assigned = await assertNoOverlap(
    db,
    branchId,
    startAt,
    endAt,
    '',
    requestedCrew,
    teamMemberIds,
  );
  const appointmentId = uuid('appt');
  const reference = `APT-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
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
      assigned.length,
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
  await assignTeam(db, actor, appointmentId, assigned);
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

function recurringSchedule(input: Record<string, unknown>) {
  const window = text(input.window, 20);
  const startTime = text(input.startTime, 5);
  const match = /^(\d{2}):(\d{2})$/.exec(startTime);
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  if (!['morning', 'afternoon'].includes(window) || !Number.isFinite(minutes) || minutes % 15 !== 0) {
    throw new AdminAuthError(400, 'recurring_window_invalid');
  }
  const valid = window === 'morning'
    ? minutes >= 7 * 60 && minutes <= 8 * 60 + 30
    : minutes >= 12 * 60 + 30 && minutes <= 14 * 60 + 30;
  if (!valid) throw new AdminAuthError(400, 'recurring_start_outside_window');
  const duration = Math.round(Number(input.durationMinutes));
  if (!Number.isFinite(duration) || duration < 30 || duration > 600) {
    throw new AdminAuthError(400, 'recurring_duration_invalid');
  }
  const crewSize = Math.round(Number(input.crewSize ?? 1));
  if (![1, 2].includes(crewSize)) throw new AdminAuthError(400, 'recurring_crew_invalid');
  return { window, startTime, duration, crewSize };
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
  const schedule = recurringSchedule(input);
  await db
    .prepare(
      `INSERT INTO recurring_plans
       (id, customer_id, property_id, branch_id, service_code, frequency, status, ongoing_price_cents, start_date, next_visit_date, terms_version, window, start_time, duration_minutes, crew_size, first_duration_minutes)
       VALUES (?, ?, ?, ?, 'residential-cleaning', ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, customerId, propertyId, branchId, frequency, price, startDate, startDate, text(input.termsVersion, 80) || 'admin.v1', schedule.window, schedule.startTime, schedule.duration, schedule.crewSize, Number(input.firstDurationMinutes) > 0 ? Math.round(Number(input.firstDurationMinutes)) : schedule.duration)
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
  const schedule = recurringSchedule({
    window: text(input.window, 20) || current.window,
    startTime: text(input.startTime, 5) || current.start_time,
    durationMinutes: input.durationMinutes ?? current.duration_minutes,
    crewSize: input.crewSize ?? current.crew_size,
  });
  await db
    .prepare(
      `UPDATE recurring_plans SET frequency = ?, status = ?, ongoing_price_cents = ?, start_date = ?, next_visit_date = ?, window = ?, start_time = ?, duration_minutes = ?, crew_size = ?, first_duration_minutes = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(frequency, status, Math.max(0, Math.round(Number(input.ongoingPrice ?? Number(current.ongoing_price_cents) / 100) * 100) || 0), startDate, nextVisit, schedule.window, schedule.startTime, schedule.duration, schedule.crewSize, input.firstDurationMinutes ?? current.first_duration_minutes ?? schedule.duration, now(), planId)
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

function booleanInput(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function workdaysInput(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  const days = raw
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
  return days.length > 0 ? [...new Set(days)].sort().join(',') : '0,1,2,3,4,5,6';
}

function clockInput(value: unknown, fallback: string): string {
  const raw = text(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : fallback;
}

function resourceIdInput(value: unknown, fallback: string): string {
  const raw = text(value, 80);
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(raw) ? raw : fallback;
}

export async function createTeamMember(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string; bookingResourceId: string }> {
  const name = text(input.displayName, 120);
  if (!name) throw new AdminAuthError(400, 'team_name_required');
  const id = uuid('team');
  const bookingResourceId = resourceIdInput(input.bookingResourceId, id);
  const isSolo = booleanInput(input.isSolo);
  const isLead = booleanInput(input.isLead);
  await db
    .prepare(
      `INSERT INTO team_members
       (id, branch_id, display_name, email, phone, status, is_bookable, booking_resource_id,
        is_solo, is_lead, workdays, workday_start, workday_end, default_rate_type,
        pay_rate_regular_cents, pay_rate_lead_cents, pay_rate_solo_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1800, 2200, 2500)`,
    )
    .bind(
      id,
      branchFor(actor, input.branchId),
      name,
      text(input.email, 200).toLowerCase(),
      text(input.phone, 30),
      input.status === 'inactive' ? 'inactive' : 'active',
      input.isBookable === false ? 0 : 1,
      bookingResourceId,
      isSolo ? 1 : 0,
      isLead ? 1 : 0,
      workdaysInput(input.workdays),
      clockInput(input.workdayStart, '07:00'),
      clockInput(input.workdayEnd, '18:00'),
      ['regular', 'lead', 'solo'].includes(text(input.defaultRateType, 20)) ? text(input.defaultRateType, 20) : 'regular',
    )
    .run();
  await audit(db, { actorUserId: actor.id, action: 'team.created', entityType: 'team_member', entityId: id });
  return { id, bookingResourceId };
}

export async function findOrCreateTeamMember(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string; created: boolean }> {
  const email = text(input.email, 200).toLowerCase();
  if (email) {
    const existing = await db
      .prepare(`SELECT id FROM team_members WHERE lower(email) = ? ${scope(actor, 'branch_id').sql} ORDER BY created_at LIMIT 1`)
      .bind(email, ...scope(actor, 'branch_id').bind)
      .first<{ id: string }>();
    if (existing) {
      await updateTeamMember(db, actor, existing.id, { ...input, email });
      return { id: existing.id, created: false };
    }
  }
  const created = await createTeamMember(db, actor, input);
  return { id: created.id, created: true };
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
  const isSolo = input.isSolo === undefined ? Number(current.is_solo) === 1 : booleanInput(input.isSolo);
  const isLead = input.isLead === undefined ? Number(current.is_lead) === 1 : booleanInput(input.isLead);
  const bookingResourceId = resourceIdInput(input.bookingResourceId, String(current.booking_resource_id ?? memberId));
  await db
    .prepare(
      `UPDATE team_members
       SET display_name = ?, email = ?, phone = ?, status = ?, is_bookable = ?,
           booking_resource_id = ?, is_solo = ?, is_lead = ?, workdays = ?,
           workday_start = ?, workday_end = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      text(input.displayName, 120) || current.display_name,
      text(input.email, 200).toLowerCase() || current.email,
      text(input.phone, 30) || current.phone,
      input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : current.status,
      input.isBookable === undefined ? current.is_bookable : input.isBookable === false ? 0 : 1,
      bookingResourceId,
      isSolo ? 1 : 0,
      isLead ? 1 : 0,
      input.workdays === undefined ? current.workdays : workdaysInput(input.workdays),
      clockInput(input.workdayStart, String(current.workday_start ?? '07:00')),
      clockInput(input.workdayEnd, String(current.workday_end ?? '18:00')),
      now(),
      memberId,
    )
    .run();
  await audit(db, { actorUserId: actor.id, action: 'team.updated', entityType: 'team_member', entityId: memberId });
}

export async function setAppointmentTeam(
  db: D1Database,
  actor: AdminActor,
  appointmentId: string,
  memberIds: string[],
): Promise<{ memberIds: string[] }> {
  const appointment = await db
    .prepare(`SELECT * FROM appointments WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(appointmentId, ...scope(actor, 'branch_id').bind)
    .first<Record<string, unknown>>();
  if (!appointment) throw new AdminAuthError(404, 'appointment_not_found');
  const unique = [...new Set(memberIds.filter(Boolean))];
  if (unique.length > bookingConfig.maxCrewSize) throw new AdminAuthError(400, 'crew_too_large');

  const members: Array<{ id: string; is_solo: number; is_lead: number }> = [];
  for (const memberId of unique) {
    const member = await db
      .prepare(
        `SELECT id, is_solo, is_lead FROM team_members
         WHERE id = ? AND status = 'active' AND is_bookable = 1 ${scope(actor, 'branch_id').sql} LIMIT 1`,
      )
      .bind(memberId, ...scope(actor, 'branch_id').bind)
      .first<{ id: string; is_solo: number; is_lead: number }>();
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
    const onboarding = await employeeOnboardingStatus(
      db,
      member.id,
      Number(member.is_solo) === 1 ? 'solo' : Number(member.is_lead) === 1 ? 'lead' : 'helper',
    );
    if (!onboarding.satisfied) throw new AdminAuthError(409, 'employee_documents_incomplete');
    members.push(member);
  }
  if (members.length > 0 && !members.some((member) => Number(member.is_solo) === 1 || Number(member.is_lead) === 1)) {
    throw new AdminAuthError(409, 'crew_requires_lead');
  }

  await db.prepare('DELETE FROM appointment_resources WHERE appointment_id = ?').bind(appointmentId).run();
  for (const member of members) {
    const role = Number(member.is_solo) === 1 ? 'solo' : Number(member.is_lead) === 1 ? 'lead' : 'cleaner';
    await db
      .prepare('INSERT INTO appointment_resources (appointment_id, team_member_id, role) VALUES (?, ?, ?)')
      .bind(appointmentId, member.id, role)
      .run();
  }
  await db
    .prepare('UPDATE appointments SET crew_size = ?, updated_at = ? WHERE id = ?')
    .bind(Math.max(1, members.length), now(), appointmentId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'job.team_assigned',
    entityType: 'appointment',
    entityId: appointmentId,
    detail: members.map((member) => member.id).join(','),
  });
  return { memberIds: members.map((member) => member.id) };
}

export async function assignTeam(
  db: D1Database,
  actor: AdminActor,
  appointmentId: string,
  memberIds: string[],
): Promise<void> {
  const current = await db
    .prepare('SELECT team_member_id FROM appointment_resources WHERE appointment_id = ?')
    .bind(appointmentId)
    .all<{ team_member_id: string }>();
  const merged = [...(current.results ?? []).map((row) => row.team_member_id), ...memberIds];
  await setAppointmentTeam(db, actor, appointmentId, merged);
}

export async function removeTeamMember(
  db: D1Database,
  actor: AdminActor,
  appointmentId: string,
  memberId: string,
): Promise<void> {
  const current = await db
    .prepare('SELECT team_member_id FROM appointment_resources WHERE appointment_id = ?')
    .bind(appointmentId)
    .all<{ team_member_id: string }>();
  const remaining = (current.results ?? [])
    .map((row) => row.team_member_id)
    .filter((id) => id !== memberId);
  await setAppointmentTeam(db, actor, appointmentId, remaining);
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

export async function attachCalendarEvent(
  db: D1Database,
  appointmentId: string,
  eventId: string,
): Promise<void> {
  if (!eventId) throw new AdminAuthError(400, 'calendar_event_required');
  await db
    .prepare(
      `INSERT INTO calendar_links
       (id, appointment_id, provider, provider_event_id, sync_status, last_synced_at)
       VALUES (?, ?, 'google', ?, 'synced', ?)
       ON CONFLICT(provider, provider_event_id) DO UPDATE SET
         appointment_id = excluded.appointment_id,
         sync_status = 'synced',
         last_synced_at = excluded.last_synced_at,
         error_detail = ''`,
    )
    .bind(`cal_${crypto.randomUUID()}`, appointmentId, eventId, now())
    .run();
}