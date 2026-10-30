import type { D1Database } from '../admin/d1.ts';
import { hashToken } from '../admin/auth.ts';
import type { AdminActor } from '../admin/operations.ts';
import {
  DEFAULT_RATES_CENTS,
  normaliseRateType,
  type LocationStatus,
  type RateType,
} from './timekeeping.ts';

export interface EmployeeProfile {
  teamMemberId: string;
  displayName: string;
  email: string;
  branchId: string | null;
  status: string;
  defaultRateType: RateType;
  rates: Record<RateType, number>;
}

export async function employeeProfile(db: D1Database, userId: string): Promise<EmployeeProfile | null> {
  const row = await db
    .prepare(
      `SELECT tm.id, tm.display_name, tm.email, tm.branch_id, tm.status,
              tm.default_rate_type, tm.pay_rate_regular_cents, tm.pay_rate_lead_cents, tm.pay_rate_solo_cents
       FROM team_members tm JOIN admin_users u ON u.id = tm.admin_user_id
       WHERE u.id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const defaultRate = normaliseRateType(row.default_rate_type) ?? 'regular';
  return {
    teamMemberId: String(row.id),
    displayName: String(row.display_name ?? ''),
    email: String(row.email ?? ''),
    branchId: row.branch_id ? String(row.branch_id) : null,
    status: String(row.status ?? 'active'),
    defaultRateType: defaultRate,
    rates: {
      regular: positive(row.pay_rate_regular_cents) ?? DEFAULT_RATES_CENTS.regular,
      lead: positive(row.pay_rate_lead_cents) ?? DEFAULT_RATES_CENTS.lead,
      solo: positive(row.pay_rate_solo_cents) ?? DEFAULT_RATES_CENTS.solo,
    },
  };
}

function positive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

export function employeeRoleAllowed(actor: AdminActor): boolean {
  return actor.role === 'cleaner' || actor.role === 'manager' || actor.role === 'owner';
}

export function managerOrOwner(actor: AdminActor): boolean {
  return actor.role === 'owner' || actor.role === 'manager';
}

export async function openInterval(
  db: D1Database,
  userId: string,
): Promise<Record<string, unknown> | null> {
  return db
    .prepare('SELECT * FROM time_intervals WHERE admin_user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .bind(userId)
    .first<Record<string, unknown>>();
}

export interface AssignmentCheck {
  ok: boolean;
  crewSize: number;
  assigned: number;
}

export async function assignmentFor(
  db: D1Database,
  teamMemberId: string,
  appointmentId: string,
): Promise<AssignmentCheck> {
  const row = await db
    .prepare(
      `SELECT a.crew_size,
              (SELECT COUNT(*) FROM appointment_resources ar2 WHERE ar2.appointment_id = a.id) AS assigned,
              (SELECT COUNT(*) FROM appointment_resources ar3
                WHERE ar3.appointment_id = a.id AND ar3.team_member_id = ?) AS mine
       FROM appointments a WHERE a.id = ? LIMIT 1`,
    )
    .bind(teamMemberId, appointmentId)
    .first<{ crew_size: number; assigned: number; mine: number }>();
  if (!row) return { ok: false, crewSize: 0, assigned: 0 };
  return {
    ok: Number(row.mine) > 0,
    crewSize: Number(row.crew_size) || 1,
    assigned: Number(row.assigned) || 0,
  };
}

export interface LocationInput {
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  status?: unknown;
  deviceTime?: unknown;
}

export interface NormalizedLocation {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  status: LocationStatus;
  deviceTime: string | null;
}

/**
 * Never invents coordinates. The browser reports permission outcomes; the
 * server independently classifies the accuracy so an absent GPS fix cannot be
 * presented as captured.
 */
export function normalizeLocation(input: LocationInput | null | undefined): NormalizedLocation {
  const numeric = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN);
  const lat = numeric(input?.lat);
  const lng = numeric(input?.lng);
  const accuracy = numeric(input?.accuracy);
  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const declared = typeof input?.status === 'string' ? input.status : '';
  const deviceTime = typeof input?.deviceTime === 'string' ? input.deviceTime.slice(0, 40) : null;
  if (hasCoords) {
    if (Number.isFinite(accuracy) && accuracy > 300) {
      return { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null, status: 'inaccurate', deviceTime };
    }
    return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null, status: 'captured', deviceTime };
  }
  if (declared === 'denied') return { lat: null, lng: null, accuracy: null, status: 'denied', deviceTime };
  return { lat: null, lng: null, accuracy: null, status: 'unavailable', deviceTime };
}

export interface ClockEventInput {
  userId: string;
  teamMemberId: string;
  action: string;
  appointmentId: string | null;
  request: Request;
  location: NormalizedLocation;
}

export async function recordTimeEvent(
  db: D1Database,
  input: ClockEventInput,
): Promise<{ id: string; occurredAt: string }> {
  const occurredAt = new Date().toISOString();
  const id = `tev_${crypto.randomUUID()}`;
  const ip = input.request.headers.get('CF-Connecting-IP') ?? '';
  const userAgent = input.request.headers.get('User-Agent') ?? '';
  await db
    .prepare(
      `INSERT INTO time_events
       (id, admin_user_id, team_member_id, appointment_id, action, occurred_at, device_time,
        lat, lng, accuracy_m, location_status, ip_hash, user_agent_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.teamMemberId,
      input.appointmentId,
      input.action,
      occurredAt,
      input.location.deviceTime,
      input.location.lat,
      input.location.lng,
      input.location.accuracy,
      input.location.status,
      ip ? await hashToken(ip) : null,
      userAgent ? await hashToken(userAgent) : null,
    )
    .run();
  return { id, occurredAt };
}
