/**
 * Commercial contract service scheduling. Accepted contracts become recurring
 * plans only after an administrator confirms structured scheduling fields and
 * reviews the availability preview. Free-text proposal terms never create
 * appointments.
 */
import { bookingConfig } from '../../config/booking.ts';
import { availabilityForDate, type BookingEnv } from '../booking/service.ts';
import { addDays, zonedTimeToUtc } from '../booking/time.ts';
import { resolveAddress } from '../location/server-geocode.ts';
import type { AdminDbEnv, D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit, type AdminActor } from '../admin/operations.ts';
import {
  effectiveRecurringSchedule,
  occurrenceDatesWithin,
  setRecurringStatus,
  syncRecurringPlan,
  type RecurringDependencies,
  type RecurringEnv,
} from '../admin/recurring-schedule.ts';
import type { ProposalScope } from './service.ts';

export interface CommercialScheduleEnv extends BookingEnv, AdminDbEnv {}
export type CommercialScheduleDependencies = Partial<RecurringDependencies>;

interface ContractRow extends Record<string, unknown> {
  id: string;
  branch_id: string | null;
  customer_id: string;
  property_id: string | null;
  status: string;
  frequency: string;
  billing_frequency: string;
  start_date: string;
  payment_terms: string;
  recurring_total_cents: number;
  snapshot_json: string;
  scope_json: string;
}

interface PropertyRow extends Record<string, unknown> {
  id: string;
  customer_id: string;
  branch_id: string | null;
  label: string;
  line1: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  access_notes: string;
  parking_notes: string;
}

export interface CommercialScheduleInput {
  contractId?: string;
  propertyId: string;
  frequency: string;
  startDate: string;
  window: string;
  startTime: string;
  durationMinutes: number;
  firstDurationMinutes: number;
  crewSize: number;
  scopeNotes?: string;
  accessInstructions?: string;
  requiredQualifications?: string;
}

export interface CommercialSchedulePreview {
  ok: boolean;
  schedule: {
    frequency: string;
    startDate: string;
    window: string;
    startTime: string;
    durationMinutes: number;
    firstDurationMinutes: number;
    crewSize: number;
  };
  dates: Array<{ date: string; start: string; end: string; resourceIds: string[] }>;
  conflicts: Array<{ date: string; reason: string }>;
  propertyId: string;
  accessInstructions: string;
  scopeNotes: string;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function timeZoneForBranch(branchId: string | null | undefined): string {
  return branchId === 'branch_tampa' ? 'America/New_York' : 'America/Chicago';
}

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function loadContract(
  db: D1Database,
  actor: AdminActor,
  contractId: string,
): Promise<ContractRow> {
  const row = await db
    .prepare('SELECT * FROM commercial_contracts WHERE id = ? LIMIT 1')
    .bind(contractId)
    .first<ContractRow>();
  if (!row) throw new AdminAuthError(404, 'contract_not_found');
  if (actor.role !== 'owner' && actor.branchId && row.branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'branch_scope_denied');
  }
  return row;
}

async function loadProperty(
  db: D1Database,
  actor: AdminActor,
  contract: ContractRow,
  propertyId: string,
): Promise<PropertyRow> {
  const property = await db
    .prepare('SELECT * FROM properties WHERE id = ? AND customer_id = ? LIMIT 1')
    .bind(propertyId, contract.customer_id)
    .first<PropertyRow>();
  if (!property) throw new AdminAuthError(400, 'contract_property_invalid');
  if (contract.branch_id && property.branch_id && property.branch_id !== contract.branch_id) {
    throw new AdminAuthError(409, 'contract_property_branch_mismatch');
  }
  if (actor.role !== 'owner' && actor.branchId && property.branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'branch_scope_denied');
  }
  return property;
}

function contractScope(contract: ContractRow): ProposalScope {
  const candidates = [contract.snapshot_json, contract.scope_json];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(String(candidate ?? '{}')) as Record<string, unknown>;
      const source = parsed.scope && typeof parsed.scope === 'object' ? parsed.scope : parsed;
      const scope = source as Partial<ProposalScope>;
      if (Array.isArray(scope.locations)) {
        return {
          locations: scope.locations,
          oneTimeCharges: Array.isArray(scope.oneTimeCharges) ? scope.oneTimeCharges : [],
          addOns: Array.isArray(scope.addOns) ? scope.addOns : [],
          supplies: String(scope.supplies ?? ''),
          equipment: String(scope.equipment ?? ''),
          crewRequirements: String(scope.crewRequirements ?? ''),
          scheduleNotes: String(scope.scheduleNotes ?? ''),
          exclusions: String(scope.exclusions ?? ''),
        };
      }
    } catch {
      // Try the next stored representation.
    }
  }
  return {
    locations: [],
    oneTimeCharges: [],
    addOns: [],
    supplies: '',
    equipment: '',
    crewRequirements: '',
    scheduleNotes: '',
    exclusions: '',
  };
}

export function defaultScopeForProperty(contract: ContractRow, propertyId: string): string {
  const scope = contractScope(contract);
  const location =
    scope.locations.find((entry) => String(entry.propertyId) === propertyId) ?? scope.locations[0];
  if (!location) return '';
  const lines = [location.notes].filter(Boolean);
  for (const area of location.areas) {
    const tasks = area.tasks
      .map((task) => `${task.name}${task.frequency ? ` (${task.frequency})` : ''}`)
      .join(', ');
    if (area.name || tasks) lines.push(`${area.name}${tasks ? `: ${tasks}` : ''}`);
  }
  return lines.join('\n').slice(0, 2000);
}

async function destinationFor(
  env: CommercialScheduleEnv,
  property: PropertyRow,
  deps: CommercialScheduleDependencies,
): Promise<{ lat: number; lng: number } | null> {
  const lat = Number(property.latitude);
  const lng = Number(property.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.01 && Math.abs(lng) > 0.01) {
    return { lat, lng };
  }
  const address = [property.line1, property.city, property.state, property.postal_code]
    .filter((part) => typeof part === 'string' && part.trim().length > 1)
    .join(', ');
  if (address.length < 5) return null;
  const resolved = await (deps.geocode ?? resolveAddress)(env, address).catch(() => null);
  return resolved ? { lat: resolved.lat, lng: resolved.lng } : null;
}

function normalizeInput(input: CommercialScheduleInput): CommercialScheduleInput {
  return {
    propertyId: text(input.propertyId, 100),
    frequency: text(input.frequency, 20),
    startDate: text(input.startDate, 10),
    window: text(input.window, 20),
    startTime: text(input.startTime, 10),
    durationMinutes: Math.round(Number(input.durationMinutes)),
    firstDurationMinutes: Math.round(Number(input.firstDurationMinutes)),
    crewSize: Math.round(Number(input.crewSize)),
    scopeNotes: text(input.scopeNotes, 2000),
    accessInstructions: text(input.accessInstructions, 2000),
    requiredQualifications: text(input.requiredQualifications, 1000),
  };
}

export async function previewCommercialSchedule(
  env: CommercialScheduleEnv,
  db: D1Database,
  actor: AdminActor,
  input: CommercialScheduleInput,
  deps: CommercialScheduleDependencies = {},
): Promise<CommercialSchedulePreview> {
  if (!input.contractId) throw new AdminAuthError(400, 'contract_required');
  const contract = await loadContract(db, actor, text(input.contractId, 100));
  if (contract.status !== 'active') throw new AdminAuthError(409, 'contract_not_active');
  const normalized = normalizeInput(input);
  if (!normalized.propertyId) throw new AdminAuthError(400, 'contract_property_required');
  const property = await loadProperty(db, actor, contract, normalized.propertyId);
  const schedule = effectiveRecurringSchedule(
    {
      frequency: normalized.frequency,
      start_date: normalized.startDate,
      window: normalized.window,
      start_time: normalized.startTime,
      duration_minutes: normalized.durationMinutes,
      first_duration_minutes: normalized.firstDurationMinutes,
      crew_size: normalized.crewSize,
    },
    {},
  );
  const destination = await destinationFor(env, property, deps);
  const scopeNotes = normalized.scopeNotes || defaultScopeForProperty(contract, property.id);
  const accessInstructions =
    normalized.accessInstructions || text(property.access_notes, 2000);
  if (!destination) {
    return {
      ok: false,
      schedule,
      dates: [],
      conflicts: [{ date: schedule.startDate, reason: 'property_location_missing' }],
      propertyId: property.id,
      accessInstructions,
      scopeNotes,
    };
  }
  const timeZone = timeZoneForBranch(contract.branch_id);
  const today = todayIn(timeZone);
  const horizon = addDays(today, bookingConfig.maxAdvanceDays);
  const dates = occurrenceDatesWithin(schedule.startDate, schedule.frequency, today, horizon);
  if (dates.length === 0) {
    return {
      ok: false,
      schedule,
      dates: [],
      conflicts: [{ date: schedule.startDate, reason: 'no_occurrences_in_window' }],
      propertyId: property.id,
      accessInstructions,
      scopeNotes,
    };
  }
  const availability = deps.availability ?? availabilityForDate;
  const conflicts: CommercialSchedulePreview['conflicts'] = [];
  const prepared: CommercialSchedulePreview['dates'] = [];
  for (const date of dates) {
    const duration =
      date === schedule.startDate ? schedule.firstDurationMinutes : schedule.durationMinutes;
    const start = zonedTimeToUtc(date, schedule.startTime, timeZone);
    const result = await availability(env, {
      date,
      durationMinutes: duration,
      destination,
      crewSize: schedule.crewSize,
      ...(contract.branch_id
        ? { branchId: contract.branch_id as 'branch_pensacola' | 'branch_tampa' }
        : {}),
      excludeEventIds: [],
    });
    if (!result.ok) {
      conflicts.push({ date, reason: result.reason });
      continue;
    }
    const exact = result.availability.slots.find((slot) => slot.start === start.toISOString());
    if (!exact) {
      conflicts.push({ date, reason: 'slot_unavailable' });
      continue;
    }
    prepared.push({ date, start: exact.start, end: exact.end, resourceIds: exact.resourceIds });
  }
  return {
    ok: conflicts.length === 0 && prepared.length === dates.length,
    schedule,
    dates: prepared,
    conflicts,
    propertyId: property.id,
    accessInstructions,
    scopeNotes,
  };
}

export async function approveCommercialSchedule(
  env: CommercialScheduleEnv,
  db: D1Database,
  actor: AdminActor,
  input: CommercialScheduleInput,
  deps: CommercialScheduleDependencies = {},
): Promise<{
  scheduleId: string;
  planId: string;
  preview: CommercialSchedulePreview;
  sync: { status: string; created: number; skipped: number; conflicts: number; errors: string[] };
}> {
  if (!input.contractId) throw new AdminAuthError(400, 'contract_required');
  const contract = await loadContract(db, actor, text(input.contractId, 100));
  if (contract.status !== 'active') throw new AdminAuthError(409, 'contract_not_active');
  const normalized = normalizeInput(input);
  const existing = await db
    .prepare(
      `SELECT id FROM commercial_contract_schedules
       WHERE contract_id = ? AND property_id = ? AND status IN ('approved','active','paused')
       LIMIT 1`,
    )
    .bind(contract.id, normalized.propertyId)
    .first<{ id: string }>();
  if (existing) throw new AdminAuthError(409, 'commercial_schedule_exists');
  const preview = await previewCommercialSchedule(env, db, actor, { ...normalized, contractId: contract.id }, deps);
  if (!preview.ok) throw new AdminAuthError(409, 'commercial_schedule_conflicts');
  const property = await loadProperty(db, actor, contract, normalized.propertyId);
  const planId = `plan_${crypto.randomUUID()}`;
  const scheduleId = `csched_${crypto.randomUUID()}`;
  const bookingReference = `COM-${contract.id}-${property.id}`;
  const schedule = preview.schedule;
  const notes = preview.scopeNotes;
  const access = preview.accessInstructions;
  const qualifications = normalized.requiredQualifications ?? '';
  const statements = [
    db
      .prepare(
        `INSERT INTO recurring_plans
         (id, customer_id, property_id, branch_id, service_code, frequency, status,
          ongoing_price_cents, start_date, next_visit_date, terms_version, booking_reference,
          sync_status, commercial_schedule_id, scope_notes, access_instructions,
          required_qualifications, window, start_time, duration_minutes, first_duration_minutes,
          crew_size)
         VALUES (?, ?, ?, ?, 'commercial-cleaning', ?, 'active', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        planId,
        contract.customer_id,
        property.id,
        contract.branch_id,
        schedule.frequency,
        Number(contract.recurring_total_cents) || 0,
        schedule.startDate,
        schedule.startDate,
        contract.id,
        bookingReference,
        scheduleId,
        notes,
        access,
        qualifications,
        schedule.window,
        schedule.startTime,
        schedule.durationMinutes,
        schedule.firstDurationMinutes,
        schedule.crewSize,
      ),
    db
      .prepare(
        `INSERT INTO commercial_contract_schedules
         (id, contract_id, property_id, branch_id, recurring_plan_id, status, frequency,
          start_date, window, start_time, duration_minutes, first_duration_minutes, crew_size,
          scope_notes, access_instructions, required_qualifications, preview_json,
          conflicts_json, approved_by_admin_user_id, approved_at, created_by_admin_user_id)
         VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
      )
      .bind(
        scheduleId,
        contract.id,
        property.id,
        contract.branch_id,
        planId,
        schedule.frequency,
        schedule.startDate,
        schedule.window,
        schedule.startTime,
        schedule.durationMinutes,
        schedule.firstDurationMinutes,
        schedule.crewSize,
        notes,
        access,
        qualifications,
        JSON.stringify(preview.dates.slice(0, 60)),
        actor.id,
        new Date().toISOString(),
        actor.id,
      ),
  ];
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  const sync = await syncRecurringPlan(env as RecurringEnv, db, actor, planId, {
    schedule: {
      frequency: schedule.frequency,
      startDate: schedule.startDate,
      window: schedule.window,
      startTime: schedule.startTime,
      durationMinutes: schedule.durationMinutes,
      firstDurationMinutes: schedule.firstDurationMinutes,
      crewSize: schedule.crewSize,
    },
    deps,
  }).catch(async (error: unknown) => {
    await db
      .prepare(
        `UPDATE commercial_contract_schedules SET status = 'paused', updated_at = ? WHERE id = ?`,
      )
      .bind(new Date().toISOString(), scheduleId)
      .run();
    await db
      .prepare('UPDATE recurring_plans SET status = ? WHERE id = ?')
      .bind('paused', planId)
      .run();
    throw error;
  });
  if (!sync.ok) {
    await db
      .prepare(
        `UPDATE commercial_contract_schedules SET status = 'paused', updated_at = ? WHERE id = ?`,
      )
      .bind(new Date().toISOString(), scheduleId)
      .run();
    await db
      .prepare('UPDATE recurring_plans SET status = ? WHERE id = ?')
      .bind('paused', planId)
      .run();
    throw new AdminAuthError(409, 'commercial_schedule_sync_failed');
  }
  await db
    .prepare(
      `UPDATE commercial_contract_schedules SET status = 'active', updated_at = ? WHERE id = ?`,
    )
    .bind(new Date().toISOString(), scheduleId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.schedule_approved',
    entityType: 'commercial_contract_schedule',
    entityId: scheduleId,
    detail: `${contract.id}:${property.id}:${planId}`,
  });
  return {
    scheduleId,
    planId,
    preview,
    sync: {
      status: sync.status,
      created: sync.created,
      skipped: sync.skipped,
      conflicts: sync.conflicts.length,
      errors: sync.errors,
    },
  };
}

export async function listContractSchedules(
  db: D1Database,
  actor: AdminActor,
  contractId: string,
): Promise<Array<Record<string, unknown>>> {
  const contract = await loadContract(db, actor, contractId);
  const rows = await db
    .prepare(
      `SELECT s.*, p.label AS property_label, p.line1, p.city,
              r.sync_status, r.sync_error, r.next_visit_date,
              (SELECT COUNT(*) FROM recurring_occurrences o
                WHERE o.plan_id = s.recurring_plan_id AND o.status = 'scheduled') AS scheduled_count
       FROM commercial_contract_schedules s
       LEFT JOIN properties p ON p.id = s.property_id
       LEFT JOIN recurring_plans r ON r.id = s.recurring_plan_id
       WHERE s.contract_id = ?
       ORDER BY s.created_at DESC LIMIT 50`,
    )
    .bind(contract.id)
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function setCommercialScheduleStatus(
  env: CommercialScheduleEnv,
  db: D1Database,
  actor: AdminActor,
  scheduleId: string,
  status: 'active' | 'paused' | 'cancelled',
  deps: CommercialScheduleDependencies = {},
): Promise<{ status: string; sync: string }> {
  const schedule = await db
    .prepare('SELECT * FROM commercial_contract_schedules WHERE id = ? LIMIT 1')
    .bind(text(scheduleId, 100))
    .first<Record<string, unknown>>();
  if (!schedule) throw new AdminAuthError(404, 'commercial_schedule_not_found');
  await loadContract(db, actor, String(schedule.contract_id));
  let syncStatus = 'unchanged';
  if (schedule.recurring_plan_id) {
    const sync = await setRecurringStatus(
      env as RecurringEnv,
      db,
      actor,
      String(schedule.recurring_plan_id),
      status,
      deps,
    );
    syncStatus = sync.status;
    if (!sync.ok) throw new AdminAuthError(409, 'commercial_schedule_sync_failed');
  }
  await db
    .prepare(
      'UPDATE commercial_contract_schedules SET status = ?, updated_at = ? WHERE id = ?',
    )
    .bind(status, new Date().toISOString(), schedule.id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.schedule_status_changed',
    entityType: 'commercial_contract_schedule',
    entityId: String(schedule.id),
    detail: status,
  });
  return { status, sync: syncStatus };
}

export async function contractSchedulingContext(
  db: D1Database,
  actor: AdminActor,
  contractId: string,
): Promise<{
  contract: Record<string, unknown>;
  properties: Array<Record<string, unknown>>;
  defaults: Record<string, { scopeNotes: string; accessInstructions: string }>;
  schedules: Array<Record<string, unknown>>;
}> {
  const contract = await loadContract(db, actor, contractId);
  const propertyBranch = contract.branch_id ?? null;
  const properties = await db
    .prepare(
      `SELECT id, label, line1, city, state, postal_code, access_notes, parking_notes, branch_id
       FROM properties
       WHERE customer_id = ? AND status = 'active'
         AND (? IS NULL OR branch_id = ? OR branch_id IS NULL)
       ORDER BY label, line1`,
    )
    .bind(contract.customer_id, propertyBranch, propertyBranch)
    .all<Record<string, unknown>>();
  const propertyRows = properties.results ?? [];
  const defaults: Record<string, { scopeNotes: string; accessInstructions: string }> = {};
  for (const property of propertyRows) {
    const id = String(property.id);
    defaults[id] = {
      scopeNotes: defaultScopeForProperty(contract, id),
      accessInstructions: text(property.access_notes, 2000),
    };
  }
  const schedules = await listContractSchedules(db, actor, contract.id);
  return {
    contract: {
      id: contract.id,
      customer_id: contract.customer_id,
      property_id: contract.property_id,
      branch_id: contract.branch_id,
      status: contract.status,
      start_date: contract.start_date,
      billing_frequency: contract.billing_frequency,
      payment_terms: contract.payment_terms,
      recurring_total_cents: contract.recurring_total_cents,
    },
    properties: propertyRows,
    defaults,
    schedules,
  };
}
