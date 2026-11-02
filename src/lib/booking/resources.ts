/**
 * Authoritative, database-driven cleaning capacity.
 *
 * The roster in team_members decides who can receive work. Logging into the
 * website is authentication only; a resource is bookable only when the staff
 * profile is active, marked bookable and carries a stable booking resource id.
 *
 * A lead- or solo-qualified cleaner anchors an independent crew. A helper can
 * fill the second seat of a crew but never creates a bookable slot alone.
 */
import type { D1Database } from '../admin/d1.ts';
import { activeBookingResources, bookingConfig, type BookingResource } from '../../config/booking.ts';
import type { BookingResourceWindow } from './availability.ts';
import { zonedTimeToUtc } from './time.ts';
import type { LatLng } from '../travel/server-routing.ts';

export interface StaffBookingResource {
  teamMemberId: string;
  bookingResourceId: string;
  displayName: string;
  adminUserId: string | null;
  branchId: string | null;
  isSolo: boolean;
  isLead: boolean;
  /** A lead or solo cleaner can anchor an independent job. */
  anchor: boolean;
  workdays: ReadonlyArray<number>;
  workdayStart: string;
  workdayEnd: string;
}

interface TeamRow extends Record<string, unknown> {
  id: string;
  booking_resource_id: string;
  display_name: string;
  admin_user_id: string | null;
  branch_id: string | null;
  is_solo: number;
  is_lead: number;
  workdays: string;
  workday_start: string;
  workday_end: string;
}

function parseWorkdays(raw: unknown): ReadonlyArray<number> {
  const values = String(raw ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  return values.length > 0 ? [...new Set(values)] : bookingConfig.workdays;
}

function safeTime(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function fallbackResources(): StaffBookingResource[] {
  return activeBookingResources().map((resource: BookingResource) => ({
    teamMemberId: resource.id === 'hayli' ? 'team_hayli' : resource.id,
    bookingResourceId: resource.id,
    displayName: resource.name,
    adminUserId: null,
    branchId: null,
    isSolo: resource.id === 'hayli',
    isLead: resource.id === 'hayli',
    anchor: true,
    workdays: resource.workdays ?? bookingConfig.workdays,
    workdayStart: resource.workdayStart ?? bookingConfig.workdayStart,
    workdayEnd: resource.workdayEnd ?? bookingConfig.workdayEnd,
  }));
}

/**
 * Links the existing owner account to Hayli's staff profile without creating a
 * second login. Idempotent and safe on a fresh install where the owner has not
 * enrolled yet.
 */
export async function ensureOwnerStaffLink(db: D1Database | null | undefined): Promise<void> {
  if (!db) return;
  try {
    const owner = await db
      .prepare("SELECT id, branch_id FROM admin_users WHERE lower(email) = 'owner@sparkling-standard.com' LIMIT 1")
      .first<{ id: string; branch_id: string | null }>();
    if (!owner) return;
    const existing = await db
      .prepare(
        `SELECT id FROM team_members
         WHERE (booking_resource_id = 'hayli' OR lower(email) = 'owner@sparkling-standard.com')
           AND (admin_user_id IS NULL OR admin_user_id = ?)
         LIMIT 1`,
      )
      .bind(owner.id)
      .first<{ id: string }>();
    if (existing) {
      await db
        .prepare(
          `UPDATE team_members
           SET admin_user_id = ?,
               booking_resource_id = CASE WHEN booking_resource_id = '' THEN 'hayli' ELSE booking_resource_id END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND admin_user_id IS NULL`,
        )
        .bind(owner.id, existing.id)
        .run();
      return;
    }
    const email = await db
      .prepare("SELECT id FROM team_members WHERE lower(email) = 'owner@sparkling-standard.com' LIMIT 1")
      .first<{ id: string }>();
    if (email) return;
    await db
      .prepare(
        `INSERT INTO team_members
         (id, branch_id, admin_user_id, display_name, email, status, is_bookable,
          booking_resource_id, is_solo, is_lead)
         VALUES ('team_hayli', ?, ?, 'Hayli', 'owner@sparkling-standard.com', 'active', 1,
                 'hayli', 1, 1)`,
      )
      .bind(owner.branch_id, owner.id)
      .run();
  } catch {
    // A legacy database without the qualification columns keeps the static
    // fallback until the additive migration is applied.
  }
}

export async function loadStaffResources(
  db: D1Database | null | undefined,
  date?: string,
): Promise<StaffBookingResource[]> {
  if (!db) return fallbackResources();
  await ensureOwnerStaffLink(db);
  let rows: TeamRow[] = [];
  try {
    const total = await db
      .prepare('SELECT COUNT(*) AS count FROM team_members')
      .first<{ count: number }>();
    // The static fallback exists only for a genuinely legacy/empty roster.
    // A roster whose staff are all inactive or unbookable must produce zero
    // capacity, never resurrect a placeholder cleaner.
    if (Number(total?.count ?? 0) === 0) return fallbackResources();
    const result = await db
      .prepare(
        `SELECT id, booking_resource_id, display_name, admin_user_id, branch_id,
                is_solo, is_lead, workdays, workday_start, workday_end
         FROM team_members
         WHERE status = 'active' AND is_bookable = 1 AND booking_resource_id <> ''
         ORDER BY display_name`,
      )
      .all<TeamRow>();
    rows = result.results ?? [];
  } catch {
    // A transient D1/schema failure must never resurrect a placeholder
    // cleaner. No roster means no bookable capacity.
    return [];
  }
  if (rows.length === 0) return [];

  let unavailable = new Set<string>();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    try {
      const start = zonedTimeToUtc(date, '00:00', bookingConfig.timeZone);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const timeOff = await db
        .prepare('SELECT team_member_id FROM team_time_off WHERE start_at < ? AND end_at > ?')
        .bind(end.toISOString(), start.toISOString())
        .all<{ team_member_id: string }>();
      unavailable = new Set((timeOff.results ?? []).map((row) => row.team_member_id));
    } catch {
      // Unreadable time-off storage means we cannot prove who is available.
      // Fail closed rather than allowing a booking into an unknown gap.
      return [];
    }
  }

  return rows
    .filter((row) => !unavailable.has(row.id))
    .map((row) => {
      const isSolo = Number(row.is_solo) === 1;
      const isLead = Number(row.is_lead) === 1;
      return {
        teamMemberId: row.id,
        bookingResourceId: row.booking_resource_id,
        displayName: row.display_name,
        adminUserId: row.admin_user_id,
        branchId: row.branch_id,
        isSolo,
        isLead,
        anchor: isSolo || isLead,
        workdays: parseWorkdays(row.workdays),
        workdayStart: safeTime(row.workday_start, bookingConfig.workdayStart),
        workdayEnd: safeTime(row.workday_end, bookingConfig.workdayEnd),
      };
    });
}

export function toBookingResourceWindows(
  resources: ReadonlyArray<StaffBookingResource>,
  origin: LatLng,
): BookingResourceWindow[] {
  return resources.map((resource) => ({
    id: resource.bookingResourceId,
    workdays: resource.workdays,
    workdayStart: resource.workdayStart,
    workdayEnd: resource.workdayEnd,
    origin,
    anchor: resource.anchor,
  }));
}

export async function teamMemberQualification(
  db: D1Database,
  teamMemberId: string,
): Promise<{ isSolo: boolean; isLead: boolean; anchor: boolean; active: boolean; bookable: boolean } | null> {
  const row = await db
    .prepare(
      `SELECT status, is_bookable, is_solo, is_lead FROM team_members WHERE id = ? LIMIT 1`,
    )
    .bind(teamMemberId)
    .first<{ status: string; is_bookable: number; is_solo: number; is_lead: number }>();
  if (!row) return null;
  const isSolo = Number(row.is_solo) === 1;
  const isLead = Number(row.is_lead) === 1;
  return {
    isSolo,
    isLead,
    anchor: isSolo || isLead,
    active: row.status === 'active',
    bookable: Number(row.is_bookable) === 1,
  };
}

export function bookingResourceIds(resources: ReadonlyArray<StaffBookingResource>): string[] {
  return resources.map((resource) => resource.bookingResourceId);
}
