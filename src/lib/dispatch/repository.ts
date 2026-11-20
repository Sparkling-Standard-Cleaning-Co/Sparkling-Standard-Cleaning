import type { D1Database } from '../admin/d1.ts';
import { branchConfig } from '../../config/branches.ts';
import {
  DEFAULT_DISPATCH_SETTINGS,
  requiredEquipmentForService,
  requiresLeadForService,
  type DispatchEmployee,
  type DispatchJob,
  type DispatchLatLng,
  type DispatchTimelineJob,
  type DispatchWeights,
} from './engine.ts';

export interface DispatchSettingsRow {
  branchId: string;
  mode: 'analysis_only' | 'automatic_unassigned';
  autoAssignEnabled: boolean;
  reassignmentRecommendations: boolean;
  customerReschedulingRecommendations: boolean;
  paused: boolean;
  minSavingsCents: number;
  maxCandidates: number;
  weights: DispatchWeights;
  vehicleCostCentsPerMile: number;
  travelPayPercent: number;
  lockOwner: string;
  lockExpiresAt: string | null;
  updatedAt: string;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function list(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function coordinates(latValue: unknown, lngValue: unknown): DispatchLatLng | null {
  if (latValue === null || latValue === undefined || lngValue === null || lngValue === undefined) return null;
  if (typeof latValue === 'string' && latValue.trim() === '') return null;
  if (typeof lngValue === 'string' && lngValue.trim() === '') return null;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return null;
  return { lat, lng };
}

function parseWeights(value: unknown): DispatchWeights {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as Partial<DispatchWeights>;
    return {
      travel: numberValue(parsed.travel, DEFAULT_DISPATCH_SETTINGS.weights.travel),
      miles: numberValue(parsed.miles, DEFAULT_DISPATCH_SETTINGS.weights.miles),
      labor: numberValue(parsed.labor, DEFAULT_DISPATCH_SETTINGS.weights.labor),
      workload: numberValue(parsed.workload, DEFAULT_DISPATCH_SETTINGS.weights.workload),
      continuity: numberValue(parsed.continuity, DEFAULT_DISPATCH_SETTINGS.weights.continuity),
      shared: numberValue(parsed.shared, DEFAULT_DISPATCH_SETTINGS.weights.shared),
    };
  } catch {
    return { ...DEFAULT_DISPATCH_SETTINGS.weights };
  }
}

export function timezoneForBranch(branchId: string): string {
  return branchConfig(branchId)?.timezone ?? 'America/Chicago';
}

export function settingsForRow(row: Record<string, unknown> | null): DispatchSettingsRow {
  return {
    branchId: text(row?.branch_id, 80),
    mode: row?.automation_mode === 'automatic_unassigned' ? 'automatic_unassigned' : 'analysis_only',
    autoAssignEnabled: bool(row?.auto_assign_enabled),
    reassignmentRecommendations: row?.reassignment_recommendations === undefined ? true : bool(row.reassignment_recommendations),
    customerReschedulingRecommendations: bool(row?.customer_rescheduling_recommendations),
    paused: row?.paused === undefined ? true : bool(row.paused),
    minSavingsCents: Math.max(0, Math.round(numberValue(row?.min_savings_cents, 1500))),
    maxCandidates: Math.max(1, Math.min(20, Math.round(numberValue(row?.max_candidates, 8)))),
    weights: parseWeights(row?.weights_json),
    vehicleCostCentsPerMile: Math.max(0, Math.round(numberValue(row?.vehicle_cost_cents_per_mile, 0))),
    travelPayPercent: Math.max(0, Math.min(100, Math.round(numberValue(row?.travel_pay_percent, 0)))),
    lockOwner: text(row?.lock_owner, 120),
    lockExpiresAt: text(row?.lock_expires_at, 60) || null,
    updatedAt: text(row?.updated_at, 60),
  };
}

export async function loadDispatchSettings(db: D1Database, branchId: string): Promise<DispatchSettingsRow> {
  const row = await db
    .prepare('SELECT * FROM dispatch_settings WHERE branch_id = ? LIMIT 1')
    .bind(branchId)
    .first<Record<string, unknown>>();
  return settingsForRow(row ?? { branch_id: branchId });
}

export async function saveDispatchSettings(
  db: D1Database,
  branchId: string,
  actorId: string,
  input: {
    mode?: string;
    autoAssignEnabled?: boolean;
    reassignmentRecommendations?: boolean;
    customerReschedulingRecommendations?: boolean;
    paused?: boolean;
    minSavingsCents?: number;
    maxCandidates?: number;
    weights?: Partial<DispatchWeights>;
    vehicleCostCentsPerMile?: number;
    travelPayPercent?: number;
  },
): Promise<DispatchSettingsRow> {
  const current = await loadDispatchSettings(db, branchId);
  const mode = input.mode === 'automatic_unassigned' ? 'automatic_unassigned' : input.mode === 'analysis_only' ? 'analysis_only' : current.mode;
  const weights = { ...current.weights, ...(input.weights ?? {}) };
  await db
    .prepare(
      `INSERT INTO dispatch_settings
       (branch_id, automation_mode, auto_assign_enabled, reassignment_recommendations,
        customer_rescheduling_recommendations, paused, min_savings_cents, max_candidates,
        weights_json, vehicle_cost_cents_per_mile, travel_pay_percent, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id) DO UPDATE SET
         automation_mode = excluded.automation_mode,
         auto_assign_enabled = excluded.auto_assign_enabled,
         reassignment_recommendations = excluded.reassignment_recommendations,
         customer_rescheduling_recommendations = excluded.customer_rescheduling_recommendations,
         paused = excluded.paused,
         min_savings_cents = excluded.min_savings_cents,
         max_candidates = excluded.max_candidates,
         weights_json = excluded.weights_json,
         vehicle_cost_cents_per_mile = excluded.vehicle_cost_cents_per_mile,
         travel_pay_percent = excluded.travel_pay_percent,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .bind(
      branchId,
      mode,
      input.autoAssignEnabled === undefined ? (current.autoAssignEnabled ? 1 : 0) : input.autoAssignEnabled ? 1 : 0,
      input.reassignmentRecommendations === undefined ? (current.reassignmentRecommendations ? 1 : 0) : input.reassignmentRecommendations ? 1 : 0,
      input.customerReschedulingRecommendations === undefined ? (current.customerReschedulingRecommendations ? 1 : 0) : input.customerReschedulingRecommendations ? 1 : 0,
      input.paused === undefined ? (current.paused ? 1 : 0) : input.paused ? 1 : 0,
      input.minSavingsCents === undefined ? current.minSavingsCents : Math.max(0, Math.round(input.minSavingsCents)),
      input.maxCandidates === undefined ? current.maxCandidates : Math.max(1, Math.min(20, Math.round(input.maxCandidates))),
      JSON.stringify(weights),
      input.vehicleCostCentsPerMile === undefined ? current.vehicleCostCentsPerMile : Math.max(0, Math.round(input.vehicleCostCentsPerMile)),
      input.travelPayPercent === undefined ? current.travelPayPercent : Math.max(0, Math.min(100, Math.round(input.travelPayPercent))),
      actorId,
      new Date().toISOString(),
    )
    .run();
  return loadDispatchSettings(db, branchId);
}

export async function claimDispatchLock(db: D1Database, branchId: string, owner: string): Promise<boolean> {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE dispatch_settings SET lock_owner = ?, lock_expires_at = ?
       WHERE branch_id = ? AND (lock_owner = '' OR lock_expires_at IS NULL OR lock_expires_at < ?)`,
    )
    .bind(owner, expires, branchId, now)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function releaseDispatchLock(db: D1Database, branchId: string, owner: string): Promise<void> {
  await db
    .prepare("UPDATE dispatch_settings SET lock_owner = '', lock_expires_at = NULL WHERE branch_id = ? AND lock_owner = ?")
    .bind(branchId, owner)
    .run();
}

export async function loadDispatchEmployees(
  db: D1Database,
  branchId: string,
  from: string,
  to: string,
): Promise<DispatchEmployee[]> {
  const rows = await db
    .prepare(
      `SELECT id, branch_id, display_name, status, is_bookable, is_solo, is_lead,
              workdays, workday_start, workday_end, pay_rate_regular_cents, pay_rate_lead_cents,
              pay_rate_solo_cents, default_rate_type, dispatch_services_json, dispatch_equipment_json,
              dispatch_transport_mode, dispatch_can_drive, dispatch_vehicle_seats,
              dispatch_can_transport_equipment, dispatch_max_weekly_hours, dispatch_overtime_approved,
              dispatch_origin_lat, dispatch_origin_lng
       FROM team_members
       WHERE status = 'active' AND is_bookable = 1 AND (branch_id = ? OR branch_id IS NULL)
       ORDER BY display_name`,
    )
    .bind(branchId)
    .all<Record<string, unknown>>();
  const employees = rows.results ?? [];
  if (employees.length === 0) return [];
  const ids = employees.map((row) => text(row.id, 100));
  const placeholders = ids.map(() => '?').join(',');
  const [shiftRows, timeOffRows, weeklyRows, historyRows] = await Promise.all([
    db
      .prepare(
        `SELECT team_member_id, work_date, start_time, end_time, available
         FROM dispatch_shift_overrides WHERE team_member_id IN (${placeholders})
           AND work_date >= ? AND work_date <= ?`,
      )
      .bind(...ids, from, to)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT team_member_id, start_at, end_at FROM team_time_off
         WHERE team_member_id IN (${placeholders}) AND end_at > ? AND start_at < ?`,
      )
      .bind(...ids, from, to)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT ar.team_member_id, COALESCE(SUM(a.duration_minutes), 0) AS minutes
         FROM appointment_resources ar JOIN appointments a ON a.id = ar.appointment_id
         WHERE ar.team_member_id IN (${placeholders})
           AND a.status IN ('pending','confirmed','in_progress')
           AND a.start_at >= ? AND a.start_at < ?
         GROUP BY ar.team_member_id`,
      )
      .bind(...ids, from, to)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT ar.team_member_id, a.customer_id, MAX(a.start_at) AS last_assigned
         FROM appointment_resources ar JOIN appointments a ON a.id = ar.appointment_id
         WHERE ar.team_member_id IN (${placeholders})
           AND a.status = 'completed'
           AND a.customer_id IS NOT NULL AND a.start_at >= ? AND a.start_at < ?
         GROUP BY ar.team_member_id, a.customer_id`,
      )
      .bind(...ids, new Date(Date.now() - 365 * 86_400_000).toISOString(), new Date().toISOString())
      .all<Record<string, unknown>>(),
  ]);
  const shifts = new Map<string, DispatchEmployee['shiftOverrides']>();
  for (const row of shiftRows.results ?? []) {
    const id = text(row.team_member_id, 100);
    const current = shifts.get(id) ?? [];
    current.push({
      date: text(row.work_date, 10),
      startTime: text(row.start_time, 5),
      endTime: text(row.end_time, 5),
      available: bool(row.available),
    });
    shifts.set(id, current);
  }
  const timeOff = new Map<string, DispatchEmployee['timeOff']>();
  for (const row of timeOffRows.results ?? []) {
    const id = text(row.team_member_id, 100);
    const current = timeOff.get(id) ?? [];
    current.push({ start: text(row.start_at, 40), end: text(row.end_at, 40) });
    timeOff.set(id, current);
  }
  const weekly = new Map<string, number>();
  for (const row of weeklyRows.results ?? []) {
    weekly.set(text(row.team_member_id, 100), Math.round(numberValue(row.minutes, 0)));
  }
  const history = new Map<string, string[]>();
  for (const row of historyRows.results ?? []) {
    const id = text(row.team_member_id, 100);
    const customer = text(row.customer_id, 100);
    if (!customer) continue;
    const current = history.get(id) ?? [];
    if (!current.includes(customer)) current.push(customer);
    history.set(id, current);
  }
  return employees.map((row) => {
    const id = text(row.id, 100);
    const isSolo = bool(row.is_solo);
    const isLead = bool(row.is_lead);
    const rateType = text(row.default_rate_type, 20);
    const rate = rateType === 'solo'
      ? numberValue(row.pay_rate_solo_cents, 0)
      : rateType === 'lead'
        ? numberValue(row.pay_rate_lead_cents, 0)
        : numberValue(row.pay_rate_regular_cents, 0);
    return {
      id,
      name: text(row.display_name, 120) || id,
      branchId: text(row.branch_id, 80) || null,
      status: row.status === 'active' ? 'active' : 'inactive',
      bookable: bool(row.is_bookable),
      isSolo,
      isLead,
      services: list(row.dispatch_services_json),
      equipment: list(row.dispatch_equipment_json),
      transportMode: ['independent', 'shared', 'none', 'unknown'].includes(String(row.dispatch_transport_mode))
        ? String(row.dispatch_transport_mode) as DispatchEmployee['transportMode']
        : 'unknown',
      canDrive: bool(row.dispatch_can_drive),
      seats: Math.max(0, Math.round(numberValue(row.dispatch_vehicle_seats, 0))),
      canTransportEquipment: bool(row.dispatch_can_transport_equipment),
      origin: coordinates(row.dispatch_origin_lat, row.dispatch_origin_lng),
      shiftOverrides: shifts.get(id) ?? [],
      timeOff: timeOff.get(id) ?? [],
      workdays: text(row.workdays, 40).split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      workdayStart: text(row.workday_start, 5) || '07:00',
      workdayEnd: text(row.workday_end, 5) || '18:00',
      weeklyMinutes: weekly.get(id) ?? 0,
      maxWeeklyMinutes: Math.max(1, numberValue(row.dispatch_max_weekly_hours, 40) * 60),
      overtimeApproved: bool(row.dispatch_overtime_approved),
      rateCents: rate,
      customerHistory: history.get(id) ?? [],
    };
  });
}

function serviceCodeFor(row: Record<string, unknown>): string {
  const estimate = text(row.estimate_service_code, 80);
  if (estimate) return estimate;
  const recurring = text(row.recurring_service_code, 80);
  if (recurring) return recurring;
  try {
    const payload = JSON.parse(String(row.payload_json ?? '{}')) as Record<string, unknown>;
    const fromPayload = text(payload.service_type ?? payload.service_code ?? payload.service ?? '', 80);
    if (fromPayload) return fromPayload;
  } catch {
    // fall through
  }
  return 'standard';
}

function timelineFromRows(rows: Array<Record<string, unknown>>): Record<string, DispatchTimelineJob[]> {
  const timeline: Record<string, DispatchTimelineJob[]> = {};
  for (const row of rows) {
    const memberId = text(row.team_member_id, 100);
    if (!memberId) continue;
    const job: DispatchTimelineJob = {
      id: text(row.id, 100),
      start: text(row.start_at, 40),
      end: text(row.end_at, 40),
      location: coordinates(row.latitude, row.longitude),
      assignedIds: [memberId],
    };
    (timeline[memberId] ??= []).push(job);
  }
  return timeline;
}

async function timelineRows(
  db: D1Database,
  branchId: string,
  from: string,
  to: string,
  excludeAppointmentId = '',
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      `SELECT a.id, a.start_at, a.end_at, p.latitude, p.longitude, ar.team_member_id
       FROM appointments a
       JOIN appointment_resources ar ON ar.appointment_id = a.id
       LEFT JOIN properties p ON p.id = a.property_id
       WHERE a.branch_id = ? AND a.status IN ('pending','confirmed','in_progress')
         AND a.id <> ? AND a.start_at < ? AND a.end_at > ?
       ORDER BY a.start_at`,
    )
    .bind(branchId, excludeAppointmentId, to, from)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function loadDispatchJob(
  db: D1Database,
  branchId: string,
  appointmentId: string,
): Promise<DispatchJob | null> {
  const row = await db
    .prepare(
      `SELECT a.*, p.latitude, p.longitude, e.service_code AS estimate_service_code,
              rp.service_code AS recurring_service_code, br.payload_json,
              (SELECT GROUP_CONCAT(ar.team_member_id) FROM appointment_resources ar
               WHERE ar.appointment_id = a.id) AS assigned_ids
       FROM appointments a
       LEFT JOIN properties p ON p.id = a.property_id
       LEFT JOIN estimates e ON e.id = a.estimate_id
       LEFT JOIN recurring_plans rp ON rp.id = a.recurring_plan_id
       LEFT JOIN booking_requests br ON br.id = a.booking_request_id
       WHERE a.id = ? AND a.branch_id = ? LIMIT 1`,
    )
    .bind(appointmentId, branchId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const assignedIds = text(row.assigned_ids, 2000).split(',').filter(Boolean);
  const start = text(row.start_at, 40);
  const dayStart = new Date(Date.parse(start) - 6 * 60 * 60_000).toISOString();
  const dayEnd = new Date(Date.parse(start) + 30 * 60 * 60_000).toISOString();
  const timeline = timelineFromRows(await timelineRows(db, branchId, dayStart, dayEnd, appointmentId));
  const serviceCode = serviceCodeFor(row);
  return {
    id: text(row.id, 100),
    branchId,
    start,
    end: text(row.end_at, 40),
    timeZone: text(row.timezone, 60) || timezoneForBranch(branchId),
    crewSize: Math.max(1, Math.min(4, Math.round(numberValue(row.crew_size, 1)))),
    serviceCode,
    requiredEquipment: requiredEquipmentForService(serviceCode),
    requiredLead: requiresLeadForService(serviceCode),
    location: coordinates(row.latitude, row.longitude),
    customerId: text(row.customer_id, 100),
    assignedIds,
    status: text(row.status, 30),
    updatedAt: text(row.updated_at, 60),
    existingTimeline: timeline,
  };
}

export async function listDispatchJobs(
  db: D1Database,
  branchId: string,
  input: { unassignedOnly?: boolean; from?: string; to?: string; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const from = input.from ?? new Date().toISOString();
  const to = input.to ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
  const limit = Math.max(1, Math.min(200, Math.round(input.limit ?? 100)));
  const result = await db
    .prepare(
      `SELECT a.id, a.start_at, a.end_at, a.status, a.crew_size, a.reference, a.branch_id,
              a.customer_id, a.updated_at, c.first_name, c.last_name, p.line1, p.city, p.state,
              p.latitude, p.longitude, e.service_code AS estimate_service_code,
              rp.service_code AS recurring_service_code, br.payload_json,
              (SELECT GROUP_CONCAT(ar.team_member_id) FROM appointment_resources ar
               WHERE ar.appointment_id = a.id) AS assigned_ids
       FROM appointments a
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN properties p ON p.id = a.property_id
       LEFT JOIN estimates e ON e.id = a.estimate_id
       LEFT JOIN recurring_plans rp ON rp.id = a.recurring_plan_id
       LEFT JOIN booking_requests br ON br.id = a.booking_request_id
       WHERE a.branch_id = ? AND a.status IN ('pending','confirmed')
         AND a.start_at >= ? AND a.start_at < ?
         ${input.unassignedOnly ? "AND NOT EXISTS (SELECT 1 FROM appointment_resources ar2 WHERE ar2.appointment_id = a.id)" : ''}
       ORDER BY a.start_at ASC LIMIT ?`,
    )
    .bind(branchId, from, to, limit)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function persistDecision(
  db: D1Database,
  input: {
    branchId: string;
    appointmentId: string;
    kind: string;
    status: string;
    currentTeam: string[];
    chosenTeam: string[];
    candidates: unknown[];
    constraints: unknown[];
    score: Record<string, unknown>;
    reason: string;
    scheduleVersion: string;
    calendarStatus: string;
    actorUserId: string | null;
  },
): Promise<string> {
  const id = `dispatch_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO dispatch_decisions
       (id, branch_id, appointment_id, kind, status, current_team_json, chosen_team_json,
        candidates_json, constraints_json, score_json, reason, schedule_version, calendar_status,
        actor_user_id, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.branchId,
      input.appointmentId,
      input.kind,
      input.status,
      JSON.stringify(input.currentTeam),
      JSON.stringify(input.chosenTeam),
      JSON.stringify(input.candidates).slice(0, 30_000),
      JSON.stringify(input.constraints).slice(0, 20_000),
      JSON.stringify(input.score).slice(0, 10_000),
      input.reason.slice(0, 2000),
      input.scheduleVersion,
      input.calendarStatus,
      input.actorUserId,
      input.status === 'applied' ? new Date().toISOString() : null,
    )
    .run();
  return id;
}

export async function updateDecisionStatus(
  db: D1Database,
  decisionId: string,
  status: string,
  input: { calendarStatus?: string; reason?: string; chosenTeam?: string[] } = {},
): Promise<void> {
  await db
    .prepare(
      `UPDATE dispatch_decisions SET status = ?, calendar_status = COALESCE(?, calendar_status),
         reason = CASE WHEN ? <> '' THEN ? ELSE reason END,
         chosen_team_json = COALESCE(?, chosen_team_json),
         applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END
       WHERE id = ?`,
    )
    .bind(
      status,
      input.calendarStatus ?? null,
      input.reason ?? '',
      input.reason ?? '',
      input.chosenTeam ? JSON.stringify(input.chosenTeam) : null,
      status,
      new Date().toISOString(),
      decisionId,
    )
    .run();
}

export async function assignedTeam(
  db: D1Database,
  appointmentId: string,
): Promise<{ ids: string[]; updatedAt: string; branchId: string; status: string } | null> {
  const row = await db
    .prepare('SELECT id, branch_id, status, updated_at FROM appointments WHERE id = ? LIMIT 1')
    .bind(appointmentId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const resources = await db
    .prepare('SELECT team_member_id FROM appointment_resources WHERE appointment_id = ? ORDER BY team_member_id')
    .bind(appointmentId)
    .all<{ team_member_id: string }>();
  return {
    ids: (resources.results ?? []).map((entry) => entry.team_member_id),
    updatedAt: text(row.updated_at, 60),
    branchId: text(row.branch_id, 80),
    status: text(row.status, 30),
  };
}

export async function listDispatchDecisions(
  db: D1Database,
  branchId: string,
  input: { status?: string; kind?: string; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const status = input.status ?? '';
  const kind = input.kind ?? '';
  const result = await db
    .prepare(
      `SELECT d.*, a.reference, a.start_at, c.first_name, c.last_name
       FROM dispatch_decisions d
       JOIN appointments a ON a.id = d.appointment_id
       LEFT JOIN customers c ON c.id = a.customer_id
       WHERE d.branch_id = ? AND (? = '' OR d.status = ?) AND (? = '' OR d.kind = ?)
       ORDER BY d.created_at DESC LIMIT ?`,
    )
    .bind(branchId, status, status, kind, kind, Math.max(1, Math.min(100, input.limit ?? 30)))
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function saveTeamDispatchProfile(
  db: D1Database,
  memberId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const services = Array.isArray(input.services)
    ? input.services.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
    : [];
  const equipment = Array.isArray(input.equipment)
    ? input.equipment.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
    : [];
  const transport = ['independent', 'shared', 'none', 'unknown'].includes(String(input.transportMode))
    ? String(input.transportMode)
    : 'unknown';
  const originLat = Number(input.originLat);
  const originLng = Number(input.originLng);
  await db
    .prepare(
      `UPDATE team_members SET
         dispatch_services_json = ?, dispatch_equipment_json = ?, dispatch_transport_mode = ?,
         dispatch_can_drive = ?, dispatch_vehicle_seats = ?, dispatch_can_transport_equipment = ?,
         dispatch_max_weekly_hours = ?, dispatch_overtime_approved = ?,
         dispatch_origin_address = ?, dispatch_origin_lat = ?, dispatch_origin_lng = ?,
         dispatch_origin_place_id = ?, dispatch_alt_origin_address = ?, dispatch_alt_origin_lat = ?,
         dispatch_alt_origin_lng = ?, dispatch_alt_origin_place_id = ?,
         dispatch_alt_origin_starts_at = ?, dispatch_alt_origin_ends_at = ?, dispatch_notes = ?,
         workdays = ?, workday_start = ?, workday_end = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      JSON.stringify([...new Set(services)]),
      JSON.stringify([...new Set(equipment)]),
      transport,
      input.canDrive === true ? 1 : 0,
      Math.max(0, Math.min(12, Math.round(numberValue(input.seats, 0)))),
      input.canTransportEquipment === true ? 1 : 0,
      Math.max(1, Math.min(80, numberValue(input.maxWeeklyHours, 40))),
      input.overtimeApproved === true ? 1 : 0,
      text(input.originAddress, 300),
      Number.isFinite(originLat) && originLat !== 0 ? originLat : null,
      Number.isFinite(originLng) && originLng !== 0 ? originLng : null,
      text(input.originPlaceId, 200),
      text(input.altOriginAddress, 300),
      Number.isFinite(Number(input.altOriginLat)) && Number(input.altOriginLat) !== 0 ? Number(input.altOriginLat) : null,
      Number.isFinite(Number(input.altOriginLng)) && Number(input.altOriginLng) !== 0 ? Number(input.altOriginLng) : null,
      text(input.altOriginPlaceId, 200),
      text(input.altOriginStartsAt, 40) || null,
      text(input.altOriginEndsAt, 40) || null,
      text(input.notes, 1000),
      input.workdays ? (Array.isArray(input.workdays) ? input.workdays.join(',') : String(input.workdays)) : '0,1,2,3,4,5,6',
      text(input.workdayStart, 5) || '07:00',
      text(input.workdayEnd, 5) || '18:00',
      new Date().toISOString(),
      memberId,
    )
    .run();
}
