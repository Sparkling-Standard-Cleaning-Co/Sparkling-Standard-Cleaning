// D1-backed checkout session registry.
//
// The partial unique index on (booking_hold_id) WHERE status IN
// ('creating','open') guarantees at most one active Stripe Checkout Session per
// booking hold. A new attempt must expire and supersede the old session before
// it can claim the slot. This closes the "multiple payable sessions" race
// without introducing a second payment provider or a separate database.

import type { D1Database } from '../admin/d1.ts';

export type CheckoutSlotStatus = 'creating' | 'open' | 'completed' | 'expired' | 'superseded' | 'failed';

export interface CheckoutSlotRow {
  id: string;
  bookingHoldId: string;
  quoteReference: string;
  attempt: string;
  stripeSessionId: string | null;
  status: CheckoutSlotStatus;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export type ClaimCheckoutSlotResult =
  | { ok: true; row: CheckoutSlotRow; existing: boolean }
  | { ok: false; reason: 'open' | 'completed' | 'in_progress' | 'busy'; row?: CheckoutSlotRow };

interface CheckoutSlotDbRow {
  id: string;
  booking_hold_id: string;
  quote_reference: string;
  attempt: string;
  stripe_session_id: string | null;
  status: CheckoutSlotStatus;
  amount_cents: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

const COLUMNS = `id, booking_hold_id, quote_reference, attempt, stripe_session_id, status,
  amount_cents, created_at, updated_at, expires_at`;

const STALE_CREATING_MS = 120_000;

function nowIso(): string {
  return new Date().toISOString();
}

function fromRow(row: CheckoutSlotDbRow): CheckoutSlotRow {
  return {
    id: row.id,
    bookingHoldId: row.booking_hold_id,
    quoteReference: row.quote_reference,
    attempt: row.attempt,
    stripeSessionId: row.stripe_session_id,
    status: row.status,
    amountCents: Number(row.amount_cents) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint/i.test(message);
}

export async function getActiveCheckoutSlot(
  db: D1Database,
  bookingHoldId: string,
): Promise<CheckoutSlotRow | null> {
  const row = await db
    .prepare(
      `SELECT ${COLUMNS} FROM checkout_sessions
       WHERE booking_hold_id = ? AND status IN ('creating', 'open')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(bookingHoldId)
    .first<CheckoutSlotDbRow>();
  return row ? fromRow(row) : null;
}

export async function getCheckoutSlotByAttempt(
  db: D1Database,
  attempt: string,
): Promise<CheckoutSlotRow | null> {
  if (!/^[a-f0-9]{64}$/i.test(attempt)) return null;
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM checkout_sessions WHERE attempt = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(attempt.toLowerCase())
    .first<CheckoutSlotDbRow>();
  return row ? fromRow(row) : null;
}

/**
 * Claims the single active slot for a booking hold.
 *
 * - the same attempt reuses its existing slot;
 * - a live 'open' slot must be expired by the caller, then superseded;
 * - a completed slot blocks a new charge and lets the caller return the
 *   existing successful session;
 * - a stale 'creating' slot is superseded after the claim window.
 */
export async function claimCheckoutSlot(
  db: D1Database,
  input: {
    bookingHoldId: string;
    quoteReference: string;
    attempt: string;
    amountCents: number;
    expiresAt?: string | null;
  },
): Promise<ClaimCheckoutSlotResult> {
  if (!input.bookingHoldId.trim() || !input.attempt.trim()) {
    return { ok: false, reason: 'busy' };
  }
  const attempt = input.attempt.toLowerCase();

  for (let pass = 0; pass < 6; pass += 1) {
    const completed = await db
      .prepare(
        `SELECT ${COLUMNS} FROM checkout_sessions
         WHERE booking_hold_id = ? AND status = 'completed'
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(input.bookingHoldId)
      .first<CheckoutSlotDbRow>();
    if (completed) return { ok: false, reason: 'completed', row: fromRow(completed) };

    const active = await getActiveCheckoutSlot(db, input.bookingHoldId);
    if (active) {
      if (active.attempt === attempt) return { ok: true, row: active, existing: true };
      if (active.status === 'completed') return { ok: false, reason: 'completed', row: active };
      if (active.status === 'open') return { ok: false, reason: 'open', row: active };
      const age = Date.now() - Date.parse(active.updatedAt);
      if (Number.isFinite(age) && age < STALE_CREATING_MS) {
        return { ok: false, reason: 'in_progress', row: active };
      }
      await db
        .prepare(
          `UPDATE checkout_sessions SET status = 'superseded', updated_at = ?
           WHERE id = ? AND status = 'creating'`,
        )
        .bind(nowIso(), active.id)
        .run();
      continue;
    }

    const id = `checkout_${crypto.randomUUID()}`;
    const timestamp = nowIso();
    try {
      await db
        .prepare(
          `INSERT INTO checkout_sessions
           (id, booking_hold_id, quote_reference, attempt, stripe_session_id, status,
            amount_cents, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, NULL, 'creating', ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.bookingHoldId,
          input.quoteReference,
          attempt,
          Math.max(0, Math.round(input.amountCents)),
          timestamp,
          timestamp,
          input.expiresAt ?? null,
        )
        .run();
      return {
        ok: true,
        existing: false,
        row: {
          id,
          bookingHoldId: input.bookingHoldId,
          quoteReference: input.quoteReference,
          attempt,
          stripeSessionId: null,
          status: 'creating',
          amountCents: Math.max(0, Math.round(input.amountCents)),
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: input.expiresAt ?? null,
        },
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Another request won the slot; re-read and resolve on the next pass.
    }
  }
  return { ok: false, reason: 'busy' };
}

export async function activateCheckoutSlot(
  db: D1Database,
  id: string,
  stripeSessionId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE checkout_sessions
       SET status = 'open', stripe_session_id = ?, updated_at = ?
       WHERE id = ? AND status = 'creating'`,
    )
    .bind(stripeSessionId, nowIso(), id)
    .run();
  return result.success !== false;
}

export async function setCheckoutSlotStatus(
  db: D1Database,
  id: string,
  status: 'completed' | 'expired' | 'superseded' | 'failed',
): Promise<void> {
  await db
    .prepare(
      `UPDATE checkout_sessions SET status = ?, updated_at = ?
       WHERE id = ? AND status IN ('creating', 'open')`,
    )
    .bind(status, nowIso(), id)
    .run();
}

export async function completeCheckoutSlotByAttempt(
  db: D1Database,
  attempt: string,
  stripeSessionId?: string | null,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(attempt)) return;
  await db
    .prepare(
      `UPDATE checkout_sessions
       SET status = 'completed', updated_at = ?,
           stripe_session_id = COALESCE(?, stripe_session_id)
       WHERE attempt = ? AND status IN ('creating', 'open')`,
    )
    .bind(nowIso(), stripeSessionId ?? null, attempt.toLowerCase())
    .run();
}

export async function failCheckoutSlotByAttempt(db: D1Database, attempt: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(attempt)) return;
  await db
    .prepare(
      `UPDATE checkout_sessions SET status = 'failed', updated_at = ?
       WHERE attempt = ? AND status IN ('creating', 'open')`,
    )
    .bind(nowIso(), attempt.toLowerCase())
    .run();
}

export async function expireCheckoutSlotByAttempt(db: D1Database, attempt: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(attempt)) return;
  await db
    .prepare(
      `UPDATE checkout_sessions SET status = 'expired', updated_at = ?
       WHERE attempt = ? AND status IN ('creating', 'open')`,
    )
    .bind(nowIso(), attempt.toLowerCase())
    .run();
}

export async function supersedeCheckoutSlot(
  db: D1Database,
  id: string,
  expectedAttempt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE checkout_sessions SET status = 'superseded', updated_at = ?
       WHERE id = ? AND attempt = ? AND status = 'open'`,
    )
    .bind(nowIso(), id, expectedAttempt.toLowerCase())
    .run();
  return result.success !== false;
}
