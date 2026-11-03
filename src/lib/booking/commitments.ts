// Durable booking-commitment records shared by every confirmation path.
//
// A commitment row is written before the external provider write, then updated
// after the calendar and D1 stages. A partial failure therefore survives a
// request timeout and appears in the admin recovery queue instead of being
// silently lost.

import type { D1Database } from '../admin/d1.ts';

export type CommitmentState =
  | 'pending'
  | 'calendar_created'
  | 'committed'
  | 'confirmed'
  | 'failed'
  | 'compensated'
  | 'cancelled';

export interface CommitmentRecord {
  id: string;
  bookingRequestId: string;
  reference: string;
  state: CommitmentState;
  attempts: number;
  calendarEventId: string;
  calendarOwned: boolean;
  lastError: string;
}

export async function beginBookingCommitment(
  db: D1Database,
  input: {
    bookingRequestId: string;
    reference: string;
    payload?: unknown;
  },
): Promise<string> {
  const existing = await db
    .prepare('SELECT id FROM booking_commitments WHERE reference = ? LIMIT 1')
    .bind(input.reference)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = `commit_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO booking_commitments
       (id, booking_request_id, reference, state, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      id,
      input.bookingRequestId,
      input.reference,
      JSON.stringify(input.payload ?? {}),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  return id;
}

export async function markBookingCommitment(
  db: D1Database,
  id: string,
  state: CommitmentState,
  input: {
    eventId?: string;
    owned?: boolean;
    error?: string;
    attempts?: number;
    appointmentId?: string;
  } = {},
): Promise<void> {
  await db
    .prepare(
      `UPDATE booking_commitments
       SET state = ?, calendar_event_id = COALESCE(NULLIF(?, ''), calendar_event_id),
           calendar_owned = CASE WHEN ? = 1 THEN 1 ELSE calendar_owned END,
           last_error = ?, attempts = COALESCE(?, attempts),
           appointment_id = COALESCE(?, appointment_id), updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      state,
      input.eventId ?? '',
      input.owned ? 1 : 0,
      input.error ?? '',
      input.attempts ?? null,
      input.appointmentId ?? null,
      new Date().toISOString(),
      id,
    )
    .run();
}

export async function getBookingCommitmentByReference(
  db: D1Database,
  reference: string,
): Promise<CommitmentRecord | null> {
  const row = await db
    .prepare('SELECT * FROM booking_commitments WHERE reference = ? LIMIT 1')
    .bind(reference)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    bookingRequestId: String(row.booking_request_id ?? ''),
    reference: String(row.reference ?? ''),
    state: String(row.state) as CommitmentState,
    attempts: Number(row.attempts) || 0,
    calendarEventId: String(row.calendar_event_id ?? ''),
    calendarOwned: Number(row.calendar_owned) === 1,
    lastError: String(row.last_error ?? ''),
  };
}
