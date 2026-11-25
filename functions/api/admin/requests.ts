import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf, type AdminActor } from '../../../src/lib/admin/operations.ts';
import {
  assertRequestConfirmable,
  confirmRequest,
  updateAppointmentStatus,
  updateRequestStatus,
} from '../../../src/lib/admin/scheduling.ts';
import { createCustomer, getCustomer } from '../../../src/lib/admin/crm.ts';
import type { BookingEnv } from '../../../src/lib/booking/service.ts';
import { onRequestPost as bookingAdminPost } from '../booking-admin.ts';
import { sendBookingEmail, type BookingEmailKind } from '../../../src/lib/forms/booking-email.ts';
import { DEPARTMENT_ADDRESSES, readCommunicationSettings, sendOperationalNotification } from '../../../src/lib/admin/communications.ts';
import { updateCalendarEvent } from '../../../src/lib/booking/google-calendar.ts';
import {
  beginBookingCommitment,
  markBookingCommitment,
} from '../../../src/lib/booking/commitments.ts';
import { ensureRecurringPlan } from '../../../src/lib/booking/commitment.ts';
import { syncAppointmentCalendarResources } from '../../../src/lib/admin/scheduling.ts';
import {
  cancelManualBooking,
  confirmManualBooking,
  rescheduleManualBooking,
} from '../../../src/lib/admin/manual-booking.ts';

interface Env extends AdminDbEnv, BookingEnv {
  BOOKING_OWNER_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_SITE_URL?: string;
}

async function bookingAction(
  context: { request: Request; env: Env },
  payload: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const token = context.env.BOOKING_OWNER_TOKEN?.trim();
  if (!token) return { status: 503, data: { ok: false, error: 'booking_admin_not_configured' } };
  const request = new Request(context.request.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const response = await bookingAdminPost({ request, env: context.env as never });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function recurringPlanForConfirmedRequest(
  context: { request: Request; env: Env },
  db: NonNullable<Env['DB']>,
  requestId: string,
  appointmentId: string,
  eventId: string,
): Promise<{ planId: string; status: string; conflicts: number } | null> {
  if (!eventId) return null;
  const row = await db
    .prepare(
      `SELECT r.quote_reference, r.customer_id, r.property_id, r.payload_json,
              a.start_at, a.end_at, a.duration_minutes, a.crew_size
       FROM booking_requests r JOIN appointments a ON a.booking_request_id = r.id
       WHERE r.id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!row?.customer_id || !row.property_id) return null;
  let fields: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(row.payload_json ?? '{}')) as Record<string, unknown>;
    fields = Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>;
  } catch {
    fields = {};
  }
  const frequency = fields.ongoing_frequency || fields.frequency || '';
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) return null;
  const ongoingPriceCents = Math.round(Number(fields.ongoing_price_per_visit || 0) * 100);
  if (ongoingPriceCents <= 0) return null;
  const resources = await db
    .prepare(
      `SELECT tm.booking_resource_id FROM appointment_resources ar
       JOIN team_members tm ON tm.id = ar.team_member_id
       WHERE ar.appointment_id = ?`,
    )
    .bind(appointmentId)
    .all<{ booking_resource_id: string }>();
  const resourceIds = (resources.results ?? []).map((entry) => entry.booking_resource_id).filter(Boolean);
  if (resourceIds.length === 0) return null;
  return ensureRecurringPlan(context.env, db, {
    reference: String(row.quote_reference ?? ''),
    customerId: String(row.customer_id),
    propertyId: String(row.property_id),
    serviceCode: fields.service_type || 'residential-cleaning',
    frequency,
    start: String(row.start_at ?? ''),
    end: String(row.end_at ?? ''),
    duration: Number(row.duration_minutes) || 120,
    ongoingDuration: Number(fields.ongoing_duration_minutes) || Number(row.duration_minutes) || 120,
    ongoingPriceCents,
    crewSize: Number(row.crew_size) || resourceIds.length,
    resourceIds,
    appointmentId,
    eventId,
    termsVersion: fields.terms_version || 'admin.v1',
  });
}

function scoped(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (!actor.branchId) return { sql: ' AND 1 = 0', bind: [] };
  return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const BULK_OPERATIONS = ['approve', 'archive', 'restore', 'deny', 'mark_test', 'delete_test'] as const;
type BulkOperation = (typeof BULK_OPERATIONS)[number];

interface BulkRow extends Record<string, unknown> {
  id: string;
  appointment_id: string | null;
}

async function bulkRow(
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: AdminActor,
  requestId: string,
): Promise<BulkRow | null> {
  const branch = scoped(actor, 'r.branch_id');
  return (await db
    .prepare(
      `SELECT r.*, a.id AS appointment_id, a.status AS appointment_status
       FROM booking_requests r LEFT JOIN appointments a ON a.booking_request_id = r.id
       WHERE r.id = ?${branch.sql} LIMIT 1`,
    )
    .bind(requestId, ...branch.bind)
    .first<BulkRow>()) ?? null;
}

async function bulkEligibility(
  db: NonNullable<ReturnType<typeof adminDb>>,
  operation: BulkOperation,
  row: BulkRow,
): Promise<{ ok: boolean; error?: string }> {
  const status = String(row.status ?? '');
  const appointmentStatus = String(row.appointment_status ?? '');
  const appointmentActive = ['pending', 'confirmed', 'in_progress'].includes(appointmentStatus);
  const paid = String(row.payment_status ?? 'unpaid').startsWith('paid');
  if (operation === 'archive') {
    if (row.archived_at) return { ok: true };
    if (status === 'pending' || status === 'confirmed' || appointmentActive) {
      return { ok: false, error: 'active_request_must_close_or_cancel' };
    }
    return { ok: true };
  }
  if (operation === 'restore') return { ok: true };
  if (operation === 'approve') {
    if (row.archived_at || row.closed_at || status !== 'pending') {
      return { ok: false, error: 'request_not_approvable' };
    }
    return { ok: true };
  }
  if (operation === 'deny') {
    if (row.archived_at || row.closed_at) return { ok: false, error: 'request_already_closed' };
    if (status !== 'pending' || row.appointment_id) return { ok: false, error: 'request_not_deniable' };
    if (paid || row.paid_at) return { ok: false, error: 'paid_request_requires_refund_review' };
    return { ok: true };
  }
  if (operation === 'mark_test') {
    if (/^RECURRING-rec_/i.test(String(row.quote_reference ?? ''))) {
      return { ok: false, error: 'recurring_plan_records_are_not_test_data' };
    }
    return { ok: true };
  }
  if (Number(row.is_test) !== 1) return { ok: false, error: 'not_marked_test' };
  if (paid || row.paid_at || Number(row.payment_amount_cents ?? 0) > 0) {
    return { ok: false, error: 'financial_record_retained' };
  }
  if (row.appointment_id || status !== 'pending') {
    return { ok: false, error: 'operational_record_retained' };
  }
  const reference = String(row.quote_reference ?? '');
  const linked = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM signing_requests WHERE booking_reference = ?').bind(reference).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?').bind(String(row.customer_id ?? '')).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM payment_events WHERE quote_reference = ?').bind(reference).first<{ n: number }>().catch(() => null),
    db.prepare('SELECT COUNT(*) AS n FROM booking_commitments WHERE request_id = ?').bind(String(row.id)).first<{ n: number }>().catch(() => null),
  ]);
  if (linked.some((entry) => Number(entry?.n ?? 0) > 0)) {
    return { ok: false, error: 'linked_evidence_retained' };
  }
  return { ok: true };
}

function branchTimeZone(branchId: unknown): string {
  return String(branchId ?? '') === 'branch_tampa' ? 'America/New_York' : 'America/Chicago';
}

function branchZoneLabel(branchId: unknown): string {
  return String(branchId ?? '') === 'branch_tampa' ? 'Eastern' : 'Central';
}

function dateLabel(value: unknown, branchId?: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: branchTimeZone(branchId),
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function timeLabel(start: unknown, end: unknown, branchId?: unknown): string {
  const first = new Date(String(start ?? ''));
  const second = new Date(String(end ?? ''));
  if (!Number.isFinite(first.getTime())) return '';
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: branchTimeZone(branchId),
    hour: 'numeric',
    minute: '2-digit',
  });
  if (!Number.isFinite(second.getTime())) return format.format(first);
  return `${format.format(first)} – ${format.format(second)} ${branchZoneLabel(branchId)}`;
}

function serviceLabel(payload: Record<string, unknown>): string {
  const raw = text(payload.service_label ?? payload.service ?? payload.serviceType ?? payload.service_type, 80);
  return raw ? raw.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase()) : '';
}

function payloadAddress(payload: Record<string, unknown>): string {
  return text(
    payload.locationText ??
      payload.location_text ??
      [payload.address, payload.city, payload.state, payload.zip].filter(Boolean).join(', '),
    300,
  );
}

async function customerEmail(db: NonNullable<ReturnType<typeof adminDb>>, customerId: string | null): Promise<string> {
  if (!customerId) return '';
  const row = await db
    .prepare(
      "SELECT value FROM customer_contacts WHERE customer_id = ? AND kind = 'email' ORDER BY is_primary DESC LIMIT 1",
    )
    .bind(customerId)
    .first<{ value: string }>();
  return row?.value ?? '';
}

interface NotificationInput {
  requestId: string;
  appointmentId: string | null;
  kind: BookingEmailKind;
  email: string;
  outcome: { status: string; providerStatus?: number };
  actorId: string;
}

async function logNotification(
  db: NonNullable<ReturnType<typeof adminDb>>,
  input: NotificationInput,
): Promise<void> {
  const mapped =
    input.outcome.status === 'sent' ? 'sent' : input.outcome.status === 'failed' ? 'failed' : 'skipped';
  await db
    .prepare(
      `INSERT INTO booking_notifications
       (id, booking_request_id, appointment_id, kind, recipient_email, status, provider_status,
        error_detail, attempts, created_by_admin_user_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      `bnot_${crypto.randomUUID()}`,
      input.requestId,
      input.appointmentId,
      input.kind,
      input.email.slice(0, 200),
      mapped,
      input.outcome.providerStatus ?? null,
      mapped === 'failed' ? 'provider_rejected_or_unavailable' : '',
      input.actorId,
      mapped === 'sent' ? new Date().toISOString() : null,
    )
    .run()
    .catch(() => undefined);
}

async function sendForRequest(
  context: { request: Request; env: Env },
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: AdminActor,
  row: Record<string, unknown>,
  kind: BookingEmailKind,
  overrides: { dateLabel?: string; timeLabel?: string; reason?: string; notes?: string } = {},
): Promise<{ status: string; providerStatus?: number; recipient: boolean }> {
  const payload = parsePayload(row.payload_json);
  const address = text(row.line1 ? [row.line1, row.city, row.state, row.postal_code].filter(Boolean).join(', ') : payloadAddress(payload));
  const customerName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  const email = await customerEmail(db, (row.customer_id as string | null) ?? null);
  const communication = await readCommunicationSettings(db).catch(() => null);
  const bookingReplyTo = communication
    ? DEPARTMENT_ADDRESSES[communication.settings.replyTo.bookingConfirmations]
    : context.env.RESEND_REPLY_TO;
  const outcome = await sendBookingEmail(
    {
      ...(context.env.RESEND_API_KEY ? { RESEND_API_KEY: context.env.RESEND_API_KEY } : {}),
      ...(context.env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: context.env.RESEND_FROM_EMAIL } : {}),
      ...(bookingReplyTo ? { RESEND_REPLY_TO: bookingReplyTo } : {}),
      PUBLIC_SITE_URL: context.env.PUBLIC_SITE_URL ?? new URL(context.request.url).origin,
    },
    email,
    {
      kind,
      reference: String(row.quote_reference ?? row.id ?? ''),
      ...(customerName ? { customerName } : {}),
      dateLabel: overrides.dateLabel ?? dateLabel(row.start_at, row.branch_id),
      timeLabel: overrides.timeLabel ?? timeLabel(row.start_at, row.end_at, row.branch_id),
      address,
      ...(serviceLabel(payload) ? { service: serviceLabel(payload) } : {}),
      ...(overrides.reason ? { reason: overrides.reason } : {}),
      ...(overrides.notes ?? text(payload.notes ?? payload.special_instructions, 500)
        ? { notes: overrides.notes ?? text(payload.notes ?? payload.special_instructions, 500) }
        : {}),
    },
  );
  await logNotification(db, {
    requestId: String(row.id ?? ''),
    appointmentId: (row.appointment_id as string | null) ?? null,
    kind,
    email,
    outcome,
    actorId: actor.id,
  });
  const eventKey =
    kind === 'confirmation'
      ? 'booking_confirmation'
      : kind === 'cancellation'
        ? 'customer_cancellation'
        : kind === 'reschedule' || kind === 'proposal'
          ? 'appointment_reschedule'
          : 'booking_change';
  await sendOperationalNotification(db, context.env, {
    eventKey,
    subject: `${kind === 'confirmation' ? 'Booking confirmed' : `Booking ${kind}`} - ${String(row.quote_reference ?? row.id ?? '')}`,
    text: [
      `Action: ${kind}`,
      `Reference: ${String(row.quote_reference ?? row.id ?? '')}`,
      `Customer: ${customerName || 'not recorded'}`,
      `Customer email: ${email || 'not recorded'}`,
      `Property: ${address || 'not recorded'}`,
      `Date: ${overrides.dateLabel ?? dateLabel(row.start_at, row.branch_id)}`,
      `Time: ${overrides.timeLabel ?? timeLabel(row.start_at, row.end_at, row.branch_id)}`,
      `Service: ${serviceLabel(payload) || 'not recorded'}`,
      ...(overrides.reason ? [`Reason: ${overrides.reason}`] : []),
      `Customer email outcome: ${outcome.status}`,
      '',
      'Open Operations -> Calendar & Requests to review the booking.',
      'This internal notice does not include the customer secure signing link.',
    ].join('\n'),
    idempotencyKey: `booking-${String(row.id ?? '')}-${kind}-${Date.now()}`,
    relatedType: 'booking_request',
    ...(row.id ? { relatedId: String(row.id) } : {}),
    ...(row.branch_id ? { branchId: String(row.branch_id) } : {}),
  }).catch(() => undefined);
  return { ...outcome, recipient: Boolean(email) };
}

async function requestRow(
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: AdminActor,
  id: string,
): Promise<Record<string, unknown> | null> {
  const branch = scoped(actor, 'r.branch_id');
  return db
    .prepare(
      `SELECT r.*, c.first_name, c.last_name, c.company_name, c.status AS customer_status,
              p.label AS property_label, p.line1, p.city, p.state, p.postal_code, p.access_notes,
              a.id AS appointment_id, a.status AS appointment_status, a.reference AS appointment_reference,
              a.start_at AS appointment_start, a.end_at AS appointment_end,
              a.crew_size AS appointment_crew_size, a.staffing_pending AS staffing_pending,
              a.staffing_reason AS staffing_reason,
              (SELECT GROUP_CONCAT(tm.display_name, ', ')
                 FROM appointment_resources ar JOIN team_members tm ON tm.id = ar.team_member_id
                WHERE ar.appointment_id = a.id) AS assigned_names,
              (SELECT provider_event_id FROM calendar_links cl WHERE cl.appointment_id = a.id
               ORDER BY cl.last_synced_at DESC LIMIT 1) AS calendar_event_id
       FROM booking_requests r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN properties p ON p.id = r.property_id
       LEFT JOIN appointments a ON a.booking_request_id = r.id
       WHERE r.id = ? ${branch.sql} LIMIT 1`,
    )
    .bind(id, ...branch.bind)
    .first<Record<string, unknown>>();
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    // The request detail includes customer contact information, so it uses the
    // CRM permission. Cleaners use the dedicated employee portal instead.
    const actor = await requireActor(db, context.request, 'lead.read');
    const url = new URL(context.request.url);
    const id = text(url.searchParams.get('id'));
    if (id) return json({ ok: true, ...(await detail(db, actor, id)) });

    const requestScope = scoped(actor, 'r.branch_id');
    const appointmentScope = scoped(actor, 'a.branch_id');
    const now = new Date();
    const appointmentFrom =
      text(url.searchParams.get('from'), 30) ||
      new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const appointmentTo =
      text(url.searchParams.get('to'), 30) ||
      new Date(now.getTime() + 61 * 86_400_000).toISOString().slice(0, 10) + 'T23:59:59.999Z';
    const leadScope = scoped(actor, 'l.branch_id');
    const view = text(url.searchParams.get('view') ?? 'actionable', 20) || 'actionable';
    const query = text(url.searchParams.get('q'), 100);
    const lifecycle: Record<string, string> = {
      actionable:
        " AND r.archived_at IS NULL AND r.closed_at IS NULL AND (r.status = 'pending' OR (r.status = 'confirmed' AND (a.status IS NULL OR a.status IN ('pending','confirmed','in_progress'))))",
      paid_pending:
        " AND r.archived_at IS NULL AND r.closed_at IS NULL AND r.payment_status IN ('paid_awaiting_confirmation','paid_awaiting_photos') AND r.status = 'pending'",
      pending: " AND r.status = 'pending' AND r.closed_at IS NULL AND r.archived_at IS NULL",
      confirmed:
        " AND r.status = 'confirmed' AND r.closed_at IS NULL AND r.archived_at IS NULL AND a.status IN ('pending','confirmed','in_progress')",
      completed: " AND (a.status = 'completed' OR r.status = 'completed')",
      closed: ' AND r.closed_at IS NOT NULL AND r.archived_at IS NULL',
      declined:
        " AND r.closed_at IS NULL AND r.archived_at IS NULL AND (r.status IN ('declined','released','expired') OR a.status IN ('cancelled','no_show'))",
      archived: ' AND r.archived_at IS NOT NULL',
      all: '',
      history: '',
    };
    const lifecycleSql = lifecycle[view] ?? lifecycle.actionable;
    const searchSql = query
      ? ` AND (r.quote_reference LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?
          OR p.line1 LIKE ? OR p.city LIKE ? OR p.postal_code LIKE ? OR r.payload_json LIKE ?)`
      : '';
    const searchBind = query ? Array.from({ length: 7 }, () => `%${query}%`) : [];
    const bookingColumns = await db
      .prepare('PRAGMA table_info(booking_requests)')
      .all<{ name: string }>()
      .catch(() => ({ results: [] as Array<{ name: string }> }));
    const isTestSelect = (bookingColumns.results ?? []).some((row) => row.name === 'is_test')
      ? 'r.is_test'
      : '0 AS is_test';
    const [requests, appointments, reservationLeads] = await Promise.all([
      db.prepare(
        `SELECT r.id, r.customer_id, r.status, r.quote_reference, r.requested_date, r.start_at, r.end_at,
                r.duration_minutes, r.payload_json, r.created_at, r.closed_at, r.closed_reason,
                r.archived_at, r.duplicate_of_request_id, r.previous_status, ${isTestSelect},
                r.payment_status, r.payment_reference, r.payment_amount_cents, r.paid_at,
                c.first_name, c.last_name, p.line1, p.city, p.state, p.postal_code,
                a.id AS appointment_id, a.status AS appointment_status,
                a.staffing_pending, a.staffing_reason,
                (SELECT provider_event_id FROM calendar_links cl WHERE cl.appointment_id = a.id
                 ORDER BY cl.last_synced_at DESC LIMIT 1) AS calendar_event_id
         FROM booking_requests r
         LEFT JOIN customers c ON c.id = r.customer_id
         LEFT JOIN properties p ON p.id = r.property_id
         LEFT JOIN appointments a ON a.booking_request_id = r.id
         WHERE 1 = 1 ${requestScope.sql} ${lifecycleSql} ${searchSql}
         ORDER BY CASE r.payment_status WHEN 'paid_awaiting_confirmation' THEN 0 WHEN 'paid_awaiting_photos' THEN 1 ELSE 2 END, r.start_at ASC, r.created_at DESC LIMIT 200`,
      ).bind(...requestScope.bind, ...searchBind).all(),
      db.prepare(
        `SELECT a.id, a.status, a.start_at, a.end_at, a.reference, a.crew_size, a.source,
                a.staffing_pending, a.staffing_reason,
                a.duration_minutes, a.notes, a.customer_id, a.property_id, a.booking_request_id,
                a.branch_id, a.recurring_plan_id, c.first_name, c.last_name, p.line1, p.city, p.state, p.postal_code,
                br.payload_json AS request_payload, br.quote_reference,
                (SELECT o.id FROM recurring_occurrences o
                  WHERE o.appointment_id = a.id AND o.status = 'scheduled'
                  ORDER BY o.occurrence_date LIMIT 1) AS recurring_occurrence_id,
                (SELECT o.occurrence_date FROM recurring_occurrences o
                  WHERE o.appointment_id = a.id AND o.status = 'scheduled'
                  ORDER BY o.occurrence_date LIMIT 1) AS recurring_occurrence_date,
                (SELECT GROUP_CONCAT(tm.display_name, ', ')
                   FROM appointment_resources ar
                   JOIN team_members tm ON tm.id = ar.team_member_id
                  WHERE ar.appointment_id = a.id) AS assigned_names
         FROM appointments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN properties p ON p.id = a.property_id
         LEFT JOIN booking_requests br ON br.id = a.booking_request_id
         WHERE a.start_at >= ? AND a.start_at <= ? ${appointmentScope.sql}
         ORDER BY a.start_at ASC LIMIT 400`,
      ).bind(appointmentFrom, appointmentTo, ...appointmentScope.bind).all(),
      db.prepare(
        `SELECT l.id, l.status, l.quote_reference, l.created_at, c.first_name, c.last_name
         FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.request_type = 'reservation_request' ${leadScope.sql}
         ORDER BY l.created_at DESC LIMIT 100`,
      ).bind(...leadScope.bind).all(),
    ]);
    return json({ ok: true, requests: requests.results ?? [], appointments: appointments.results ?? [], reservationLeads: reservationLeads.results ?? [] });
  } catch (error) {
    const code = error instanceof AdminAuthError ? error.code : 'requests_failed';
    const status = error instanceof AdminAuthError ? error.status : 500;
    return json({ ok: false, error: code }, status);
  }
}

async function detail(
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: AdminActor,
  id: string,
): Promise<Record<string, unknown>> {
  const row = await requestRow(db, actor, id);
  if (!row) throw new AdminAuthError(404, 'request_not_found');
  const customerId = (row.customer_id as string | null) ?? '';
  const appointmentId = String(row.appointment_id ?? '');
  const [contacts, properties, notifications, auditRows, pending, invoiceRow] = await Promise.all([
    customerId
      ? db.prepare('SELECT kind, value, is_primary FROM customer_contacts WHERE customer_id = ?').bind(customerId).all()
      : Promise.resolve({ results: [] }),
    customerId
      ? db.prepare('SELECT id, label, line1, city, state, postal_code FROM properties WHERE customer_id = ?').bind(customerId).all()
      : Promise.resolve({ results: [] }),
    db
      .prepare(
        `SELECT id, kind, status, provider_status, error_detail, created_at, sent_at
         FROM booking_notifications WHERE booking_request_id = ? ORDER BY created_at DESC LIMIT 20`,
      )
      .bind(id)
      .all(),
    db
      .prepare(
        `SELECT action, success, detail_json, created_at FROM admin_audit
         WHERE entity_id = ? ORDER BY created_at DESC LIMIT 25`,
      )
      .bind(id)
      .all(),
    db
      .prepare(
        `SELECT r.id, r.quote_reference, r.start_at, r.end_at, r.status, r.payload_json
         FROM booking_requests r WHERE r.id <> ? AND r.status = 'pending' ${scoped(actor, 'r.branch_id').sql}
         ORDER BY r.start_at ASC LIMIT 50`,
      )
      .bind(id, ...scoped(actor, 'r.branch_id').bind)
      .all(),
    db
      .prepare(
        `SELECT id, number, status, total_cents, balance_cents, due_date, created_at
         FROM invoices
         WHERE booking_request_id = ?${appointmentId ? ' OR appointment_id = ?' : ''}
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(...(appointmentId ? [id, appointmentId] : [id]))
      .first<Record<string, unknown>>(),
  ]);
  const payload = parsePayload(row.payload_json);
  const location = text(row.line1 ? [row.line1, row.city, row.state, row.postal_code].filter(Boolean).join(', ') : payloadAddress(payload)).toLowerCase();
  const start = Date.parse(String(row.start_at ?? ''));
  const possibleDuplicates = ((pending.results ?? []) as Array<Record<string, unknown>>)
    .filter((candidate) => {
      const candidatePayload = parsePayload(candidate.payload_json);
      const candidateLocation = payloadAddress(candidatePayload).toLowerCase();
      const candidateStart = Date.parse(String(candidate.start_at ?? ''));
      const samePlace = location.length > 0 && candidateLocation.length > 0 && candidateLocation === location;
      const closeInTime = Number.isFinite(start) && Number.isFinite(candidateStart) && Math.abs(candidateStart - start) <= 48 * 60 * 60 * 1000;
      return samePlace || (location.length > 0 && candidateLocation && closeInTime && candidateLocation.includes(location.split(',')[0] ?? ''));
    })
    .map((candidate) => ({
      id: String(candidate.id),
      quote_reference: String(candidate.quote_reference ?? ''),
      start_at: String(candidate.start_at ?? ''),
      end_at: String(candidate.end_at ?? ''),
    }));
  return {
    request: row,
    payload,
    contacts: contacts.results ?? [],
    properties: properties.results ?? [],
    notifications: notifications.results ?? [],
    audit: auditRows.results ?? [],
    possibleDuplicates,
    email: await customerEmail(db, customerId || null),
    invoice: invoiceRow,
  };
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'booking.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    if (action === 'bulk' || action === 'bulk_preview') {
      const operation = text(body.operation, 40) as BulkOperation;
      const ids = Array.isArray(body.requestIds)
        ? body.requestIds
            .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
            .map((value) => value.trim())
            .slice(0, 100)
        : [];
      if (ids.length === 0) return json({ ok: false, error: 'bulk_selection_required' }, 400);
      if (!BULK_OPERATIONS.includes(operation)) {
        return json({ ok: false, error: 'bulk_operation_invalid' }, 400);
      }
      if ((operation === 'mark_test' || operation === 'delete_test') && actor.role !== 'owner') {
        return json({ ok: false, error: 'owner_required' }, 403);
      }
      if (operation === 'mark_test' || operation === 'delete_test') {
        const columns = await db
          .prepare('PRAGMA table_info(booking_requests)')
          .all<{ name: string }>()
          .catch(() => ({ results: [] as Array<{ name: string }> }));
        if (!(columns.results ?? []).some((row) => row.name === 'is_test')) {
          return json({ ok: false, error: 'test_request_migration_required' }, 503);
        }
      }
      const preview: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const requestId of ids) {
        const row = await bulkRow(db, actor, requestId);
        if (!row) {
          preview.push({ id: requestId, ok: false, error: 'request_not_found' });
          continue;
        }
        preview.push({ id: requestId, ...(await bulkEligibility(db, operation, row)) });
      }
      const eligibleCount = preview.filter((entry) => entry.ok).length;
      if (action === 'bulk_preview') {
        return json({
          ok: true,
          operation,
          total: preview.length,
          eligible: eligibleCount,
          ineligible: preview.length - eligibleCount,
          results: preview,
        });
      }
      if (body.confirm !== true) return json({ ok: false, error: 'bulk_confirmation_required' }, 400);
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const requestId of ids) {
        try {
          const row = await bulkRow(db, actor, requestId);
          if (!row) {
            results.push({ id: requestId, ok: false, error: 'request_not_found' });
            continue;
          }
          const eligible = await bulkEligibility(db, operation, row);
          if (!eligible.ok) {
            results.push({ id: requestId, ok: false, ...(eligible.error ? { error: eligible.error } : {}) });
            continue;
          }
          if (operation === 'archive') {
            if (!row.archived_at) {
              await db
                .prepare(
                  `UPDATE booking_requests SET archived_at = CURRENT_TIMESTAMP,
                     previous_status = status, archived_by_admin_user_id = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?`,
                )
                .bind(actor.id, requestId)
                .run();
              await audit(db, {
                actorUserId: actor.id,
                action: 'request.bulk_archived',
                entityType: 'booking_request',
                entityId: requestId,
              });
            }
            results.push({ id: requestId, ok: true });
            continue;
          }
          if (operation === 'restore') {
            if (row.archived_at) {
              await db
                .prepare('UPDATE booking_requests SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .bind(requestId)
                .run();
              await audit(db, {
                actorUserId: actor.id,
                action: 'request.bulk_restored',
                entityType: 'booking_request',
                entityId: requestId,
              });
            }
            results.push({ id: requestId, ok: true });
            continue;
          }
          if (operation === 'approve') {
            const innerHeaders = new Headers({
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Origin: new URL(context.request.url).origin,
            });
            const cookie = context.request.headers.get('Cookie');
            if (cookie) innerHeaders.set('Cookie', cookie);
            const csrfToken = context.request.headers.get('X-CSRF-Token');
            if (csrfToken) innerHeaders.set('X-CSRF-Token', csrfToken);
            const innerResponse = await onRequestPost({
              request: new Request(context.request.url, {
                method: 'POST',
                headers: innerHeaders,
                body: JSON.stringify({ action: 'confirm', requestId, notify: false }),
              }),
              env: context.env,
            });
            const innerData = (await innerResponse.json().catch(() => ({}))) as Record<string, unknown>;
            if (innerResponse.ok && innerData.ok) {
              results.push({ id: requestId, ok: true });
            } else {
              results.push({
                id: requestId,
                ok: false,
                error: String(innerData.error ?? `approval_failed_${innerResponse.status}`).slice(0, 120),
              });
            }
            continue;
          }
          if (operation === 'deny') {
            await db
              .prepare(
                `UPDATE booking_requests SET status = 'declined', closed_at = CURRENT_TIMESTAMP,
                   closed_reason = ?, previous_status = 'pending', updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              )
              .bind('Declined by bulk action (no customer email sent)', requestId)
              .run();
            await audit(db, {
              actorUserId: actor.id,
              action: 'request.bulk_declined',
              entityType: 'booking_request',
              entityId: requestId,
            });
            results.push({ id: requestId, ok: true });
            continue;
          }
          if (operation === 'mark_test') {
            if (Number(row.is_test) !== 1) {
              await db
                .prepare(
                  `UPDATE booking_requests SET is_test = 1, test_marked_at = CURRENT_TIMESTAMP,
                     test_marked_by_admin_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                )
                .bind(actor.id, requestId)
                .run();
              await audit(db, {
                actorUserId: actor.id,
                action: 'request.marked_test',
                entityType: 'booking_request',
                entityId: requestId,
              });
            }
            results.push({ id: requestId, ok: true });
            continue;
          }
          const reference = String(row.quote_reference ?? '');
          await db.prepare('DELETE FROM booking_holds WHERE request_id = ?').bind(requestId).run().catch(() => undefined);
          await db.prepare('DELETE FROM booking_requests WHERE id = ?').bind(requestId).run();
          await audit(db, {
            actorUserId: actor.id,
            action: 'request.test_record_deleted',
            entityType: 'booking_request',
            entityId: requestId,
            detail: `reference=${reference}`,
          });
          results.push({ id: requestId, ok: true });
        } catch (error) {
          results.push({
            id: requestId,
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 120) : 'bulk_item_failed',
          });
        }
      }
      return json({
        ok: true,
        operation,
        total: ids.length,
        succeeded: results.filter((entry) => entry.ok).length,
        failed: results.filter((entry) => !entry.ok).length,
        results,
      });
    }
    const requestId = text(body.requestId, 120);
    if (!requestId) return json({ ok: false, error: 'request_required' }, 400);
    const row = await requestRow(db, actor, requestId);
    if (!row) return json({ ok: false, error: 'request_not_found' }, 404);
    const manualBooking = String(row.hold_id ?? '').startsWith('manual_');

    if (action === 'close' || action === 'duplicate' || action === 'archive' || action === 'reopen') {
      const status = String(row.status ?? '');
      const appointmentStatus = String(row.appointment_status ?? '');
      const appointmentActive = ['pending', 'confirmed', 'in_progress'].includes(appointmentStatus);
      if (action === 'reopen') {
        if (!row.closed_at && !row.archived_at) return json({ ok: false, error: 'request_not_closed' }, 409);
        if (appointmentStatus === 'completed' || appointmentStatus === 'cancelled' || appointmentStatus === 'no_show') {
          return json({ ok: false, error: 'new_request_required' }, 409);
        }
        const target = appointmentActive ? 'confirmed' : 'pending';
        await db
          .prepare("UPDATE booking_requests SET status = ?, closed_at = NULL, archived_at = NULL, closed_reason = '', duplicate_of_request_id = NULL, previous_status = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(target, requestId)
          .run();
        await audit(db, { actorUserId: actor.id, action: 'request.reopened', entityType: 'booking_request', entityId: requestId, detail: target });
        return json({ ok: true, status: target });
      }
      if (action === 'archive') {
        if (row.archived_at) return json({ ok: true, alreadyArchived: true });
        if (status === 'pending' || status === 'confirmed' || appointmentActive) {
          return json({ ok: false, error: 'active_request_must_close_or_cancel' }, 409);
        }
        await db
          .prepare('UPDATE booking_requests SET archived_at = CURRENT_TIMESTAMP, previous_status = status, archived_by_admin_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(actor.id, requestId)
          .run();
        await audit(db, { actorUserId: actor.id, action: 'request.archived', entityType: 'booking_request', entityId: requestId, detail: status });
        return json({ ok: true, archived: true });
      }
      if (row.closed_at) return json({ ok: true, alreadyClosed: true });
      if (status !== 'pending' || row.appointment_id) {
        return json({ ok: false, error: 'only_unconfirmed_pending_requests_can_close' }, 409);
      }
      let duplicateOf: string | null = null;
      if (action === 'duplicate') {
        const requested = text(body.duplicateOf, 120);
        if (!requested) return json({ ok: false, error: 'duplicate_request_required' }, 400);
        const match = await db
          .prepare('SELECT id FROM booking_requests WHERE (id = ? OR quote_reference = ?) AND id <> ? LIMIT 1')
          .bind(requested, requested, requestId)
          .first<{ id: string }>();
        if (!match) return json({ ok: false, error: 'duplicate_request_not_found' }, 404);
        duplicateOf = match.id;
      }
      const reason = text(body.reason, 500) || (duplicateOf ? 'Duplicate request' : 'Closed by staff');
      let released: { status: number; data: Record<string, unknown> };
      if (manualBooking) {
        try {
          await cancelManualBooking(context.env, db, actor, requestId, reason);
          released = { status: 200, data: { ok: true } };
        } catch (error) {
          released = {
            status: error instanceof AdminAuthError ? error.status : 502,
            data: { ok: false, error: error instanceof AdminAuthError ? error.code : 'manual_release_failed' },
          };
        }
      } else {
        released = await bookingAction(context, { id: requestId, action: 'release' });
      }
      if (!released.data.ok) {
        return json({ ok: false, error: released.data.error ?? 'hold_release_failed', calendarStatus: released.status }, released.status === 200 ? 502 : released.status);
      }
      await db
        .prepare("UPDATE booking_requests SET status = 'released', closed_at = CURRENT_TIMESTAMP, closed_reason = ?, duplicate_of_request_id = ?, previous_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(reason, duplicateOf, requestId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: duplicateOf ? 'request.closed_duplicate' : 'request.closed',
        entityType: 'booking_request',
        entityId: requestId,
        detail: duplicateOf ? reason + ' -> ' + duplicateOf : reason,
      });
      return json({ ok: true, closed: true, duplicateOf });
    }

    if (action === 'link_customer') {
      const customerId = text(body.customerId, 100);
      const propertyId = text(body.propertyId, 100) || null;
      if (!customerId) return json({ ok: false, error: 'customer_required' }, 400);
      const customer = await getCustomer(db, actor, customerId);
      if (!customer) return json({ ok: false, error: 'customer_not_found' }, 404);
      if (propertyId) {
        const property = await db
          .prepare('SELECT id FROM properties WHERE id = ? AND customer_id = ? LIMIT 1')
          .bind(propertyId, customerId)
          .first();
        if (!property) return json({ ok: false, error: 'property_invalid' }, 400);
      }
      await db
        .prepare('UPDATE booking_requests SET customer_id = ?, property_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(customerId, propertyId, requestId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'request.customer_linked',
        entityType: 'booking_request',
        entityId: requestId,
        detail: customerId,
      });
      return json({ ok: true, ...(await detail(db, actor, requestId)) });
    }

    if (action === 'create_customer') {
      const created = await createCustomer(db, actor, {
        firstName: body.firstName,
        lastName: body.lastName,
        companyName: body.companyName,
        email: body.email,
        phone: body.phone,
        addressLine1: body.addressLine1,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        source: 'legacy_request_link',
        notesSummary: `Linked from request ${String(row.quote_reference ?? requestId)}`,
      });
      const customerId = String(created.id);
      const customer = await getCustomer(db, actor, customerId);
      const property = (customer?.properties as Array<Record<string, unknown>> | undefined)?.[0];
      await db
        .prepare('UPDATE booking_requests SET customer_id = ?, property_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(customerId, property?.id ?? null, requestId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'request.customer_created',
        entityType: 'booking_request',
        entityId: requestId,
        detail: customerId,
      });
      return json({ ok: true, customerId, propertyId: property?.id ?? null, ...(await detail(db, actor, requestId)) });
    }

    if (action === 'confirm') {
      if (manualBooking) {
        const teamMemberIds = Array.isArray(body.teamMemberIds)
          ? body.teamMemberIds.map((value) => String(value)).filter(Boolean).slice(0, 12)
          : [];
        try {
          const result = await confirmManualBooking(context.env, db, actor, requestId, teamMemberIds);
          const confirmedRow = await requestRow(db, actor, requestId);
          const email = body.notify === false
            ? { status: 'skipped_no_email', recipient: false }
            : confirmedRow
              ? await sendForRequest(context, db, actor, confirmedRow, 'confirmation')
              : { status: 'skipped_no_email', recipient: false };
          return json({ ok: true, ...result, email });
        } catch (error) {
          return json(
            {
              ok: false,
              error: error instanceof AdminAuthError ? error.code : 'manual_confirm_failed',
            },
            error instanceof AdminAuthError ? error.status : 502,
          );
        }
      }
      await assertRequestConfirmable(db, actor, requestId);
      const commitmentReference = String(row.quote_reference ?? '').trim() || requestId;
      const commitmentId = await beginBookingCommitment(db, {
        bookingRequestId: requestId,
        reference: commitmentReference,
        payload: { source: 'admin_confirmation', start: row.start_at, end: row.end_at },
      });
      const calendar = await bookingAction(context, { id: requestId, action: 'confirm' });
      if (!calendar.data.ok) {
        await markBookingCommitment(db, commitmentId, 'failed', {
          error: String(calendar.data.error ?? 'calendar_confirm_failed'),
          attempts: 1,
        }).catch(() => undefined);
        return json(
          { ok: false, error: calendar.data.error ?? 'calendar_confirm_failed', calendarStatus: calendar.status },
          calendar.status === 200 ? 502 : calendar.status,
        );
      }
      const calendarEventId = String(calendar.data.eventId ?? '');
      await markBookingCommitment(db, commitmentId, 'calendar_created', {
        eventId: calendarEventId,
        owned: true,
        attempts: 1,
      }).catch(() => undefined);
      const teamMemberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.map((value) => String(value)).filter(Boolean).slice(0, 12)
        : [];
      try {
        const eventId = calendarEventId;
        const result = await confirmRequest(db, actor, requestId, teamMemberIds, eventId);
        await markBookingCommitment(db, commitmentId, 'confirmed', {
          eventId,
          appointmentId: result.appointmentId,
          attempts: 2,
        }).catch(() => undefined);
        await syncAppointmentCalendarResources(context.env, db, result.appointmentId).catch(() => undefined);
        const recurring = await recurringPlanForConfirmedRequest(
          context,
          db,
          requestId,
          result.appointmentId,
          eventId,
        ).catch(() => null);
        const confirmedRow = await requestRow(db, actor, requestId);
        const email = body.notify === false
          ? { status: 'skipped_no_email', recipient: false }
          : confirmedRow
            ? await sendForRequest(context, db, actor, confirmedRow, 'confirmation')
            : { status: 'skipped_no_email', recipient: false };
        return json({
          ok: true,
          ...result,
          calendarEventId: eventId || null,
          ...(recurring ? { recurring } : {}),
          email,
        });
      } catch (error) {
        // The calendar commitment must not survive a failed operational write.
        let compensated = false;
        if (calendarEventId) {
          const cancelled = await bookingAction(context, { id: requestId, action: 'cancel' }).catch(() => null);
          compensated = cancelled?.data.ok === true;
        }
        await markBookingCommitment(db, commitmentId, compensated ? 'compensated' : 'failed', {
          eventId: calendarEventId,
          owned: true,
          error: error instanceof AdminAuthError ? error.code : 'd1_confirm_failed',
          attempts: 2,
        }).catch(() => undefined);
        return json(
          {
            ok: false,
            error: error instanceof AdminAuthError ? error.code : 'd1_confirm_failed',
            calendarConfirmed: false,
            calendarRollbackAttempted: Boolean(calendarEventId),
            calendarRollbackSucceeded: compensated,
          },
          error instanceof AdminAuthError ? error.status : 502,
        );
      }
    }

    if (action === 'decline') {
      const reason = text(body.reason, 500);
      if (manualBooking) {
        const cancelled = await cancelManualBooking(context.env, db, actor, requestId, reason).catch((error) => {
          throw error instanceof AdminAuthError ? error : new AdminAuthError(502, 'manual_release_failed');
        });
        await db
          .prepare("UPDATE booking_requests SET status = 'declined', decline_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(reason, requestId)
          .run();
        const email =
          body.notify === true
            ? await sendForRequest(context, db, actor, row, 'decline', { reason })
            : { status: 'skipped_not_requested', recipient: false };
        return json({ ok: true, calendarEventId: cancelled.calendarEventId, email });
      }
      const calendar = await bookingAction(context, { id: requestId, action: 'decline' });
      if (!calendar.data.ok) {
        return json(
          { ok: false, error: calendar.data.error ?? 'calendar_release_failed', calendarStatus: calendar.status },
          calendar.status === 200 ? 502 : calendar.status,
        );
      }
      await db
        .prepare("UPDATE booking_requests SET status = 'declined', decline_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(reason, requestId)
        .run();
      await db
        .prepare("UPDATE booking_commitments SET state = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE reference = ?")
        .bind(String(row.quote_reference ?? ''))
        .run()
        .catch(() => undefined);
      await audit(db, {
        actorUserId: actor.id,
        action: 'request.declined',
        entityType: 'booking_request',
        entityId: requestId,
        detail: reason,
      });
      const email =
        body.notify === true
          ? await sendForRequest(context, db, actor, row, 'decline', { reason })
          : { status: 'skipped_not_requested', recipient: false };
      return json({ ok: true, email });
    }

    if (action === 'propose') {
      if (String(row.status) !== 'pending') return json({ ok: false, error: 'request_not_pending' }, 409);
      const date = text(body.date, 10);
      const start = text(body.start, 40);
      const end = text(body.end, 40);
      if (!date || !start || !end) return json({ ok: false, error: 'new_slot_required' }, 400);
      if (manualBooking) {
        try {
          const result = await rescheduleManualBooking(context.env, db, actor, requestId, {
            date,
            start,
            end,
            ...(body.durationMinutes !== undefined ? { durationMinutes: Number(body.durationMinutes) } : {}),
            ...(Array.isArray(body.teamMemberIds)
              ? { teamMemberIds: body.teamMemberIds.map((value) => String(value)).filter(Boolean) }
              : {}),
          });
          await db
            .prepare(
              `UPDATE booking_requests SET proposed_start_at = ?, proposed_end_at = ?, proposal_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            )
            .bind(result.start, result.end, requestId)
            .run();
          const email = await sendForRequest(context, db, actor, row, 'proposal', {
            dateLabel: dateLabel(result.start, row.branch_id),
            timeLabel: timeLabel(result.start, result.end, row.branch_id),
          });
          return json({ ok: true, slot: { start: result.start, end: result.end }, email });
        } catch (error) {
          return json(
            { ok: false, error: error instanceof AdminAuthError ? error.code : 'slot_unavailable' },
            error instanceof AdminAuthError ? error.status : 409,
          );
        }
      }
      const calendar = await bookingAction(context, {
        id: requestId,
        action: 'reschedule',
        date,
        start,
        end,
        ...(body.durationMinutes !== undefined ? { durationMinutes: Number(body.durationMinutes) } : {}),
      });
      if (!calendar.data.ok) {
        return json(
          { ok: false, error: calendar.data.error ?? 'slot_unavailable', calendarStatus: calendar.status },
          calendar.status === 200 ? 409 : calendar.status,
        );
      }
      const slot = (calendar.data.slot ?? {}) as Record<string, unknown>;
      const newStart = String(slot.start ?? start);
      const newEnd = String(slot.end ?? end);
      await db
        .prepare(
          `UPDATE booking_requests SET requested_date = ?, start_at = ?, end_at = ?,
             duration_minutes = ?, proposed_start_at = ?, proposed_end_at = ?,
             proposal_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(date, newStart, newEnd, Number(slot.durationMinutes) || Number(row.duration_minutes) || 120, newStart, newEnd, requestId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'request.time_proposed',
        entityType: 'booking_request',
        entityId: requestId,
        detail: `${date} ${newStart} - ${newEnd}`,
      });
      const email = await sendForRequest(context, db, actor, row, 'proposal', {
        dateLabel: dateLabel(newStart, row.branch_id),
        timeLabel: timeLabel(newStart, newEnd, row.branch_id),
      });
      return json({ ok: true, slot, email });
    }

    if (action === 'reschedule' || action === 'cancel') {
      const appointmentId = (row.appointment_id as string | null) ?? '';
      const reason = text(body.reason, 500);
      if (manualBooking) {
        if (action === 'cancel') {
          try {
            const cancelled = await cancelManualBooking(context.env, db, actor, requestId, reason);
            const email =
              body.notify === true
                ? await sendForRequest(context, db, actor, row, 'cancellation', { reason })
                : { status: 'skipped_not_requested', recipient: false };
            return json({ ok: true, calendarEventId: cancelled.calendarEventId, email });
          } catch (error) {
            return json(
              { ok: false, error: error instanceof AdminAuthError ? error.code : 'calendar_delete_failed' },
              error instanceof AdminAuthError ? error.status : 502,
            );
          }
        }
        const date = text(body.date, 10);
        const start = text(body.start, 40);
        const end = text(body.end, 40);
        if (!date || !start || !end) return json({ ok: false, error: 'new_slot_required' }, 400);
        try {
          const result = await rescheduleManualBooking(context.env, db, actor, requestId, {
            date,
            start,
            end,
            ...(body.durationMinutes !== undefined ? { durationMinutes: Number(body.durationMinutes) } : {}),
            ...(Array.isArray(body.teamMemberIds)
              ? { teamMemberIds: body.teamMemberIds.map((value) => String(value)).filter(Boolean) }
              : {}),
          });
          const email = body.notify === false
            ? { status: 'skipped_not_requested', recipient: false }
            : await sendForRequest(context, db, actor, row, 'reschedule', {
                dateLabel: dateLabel(result.start, row.branch_id),
                timeLabel: timeLabel(result.start, result.end, row.branch_id),
              });
          return json({ ok: true, slot: { start: result.start, end: result.end }, email });
        } catch (error) {
          return json(
            { ok: false, error: error instanceof AdminAuthError ? error.code : 'slot_unavailable' },
            error instanceof AdminAuthError ? error.status : 409,
          );
        }
      }
      if (!appointmentId) return json({ ok: false, error: 'appointment_not_found' }, 409);
      if (action === 'cancel') {
        const calendar = await bookingAction(context, { id: requestId, action: 'cancel' });
        if (!calendar.data.ok) {
          return json(
            { ok: false, error: calendar.data.error ?? 'calendar_delete_failed', calendarStatus: calendar.status },
            calendar.status === 200 ? 502 : calendar.status,
          );
        }
        await updateAppointmentStatus(db, actor, appointmentId, 'cancelled');
        await db
          .prepare("UPDATE booking_requests SET status = 'released', decline_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(reason, requestId)
          .run();
        await db
          .prepare("UPDATE booking_commitments SET state = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE reference = ?")
          .bind(String(row.quote_reference ?? ''))
          .run()
          .catch(() => undefined);
        await audit(db, {
          actorUserId: actor.id,
          action: 'request.appointment_cancelled',
          entityType: 'booking_request',
          entityId: requestId,
          detail: reason,
        });
        const email =
          body.notify === true
            ? await sendForRequest(context, db, actor, row, 'cancellation', { reason })
            : { status: 'skipped_not_requested', recipient: false };
        return json({ ok: true, email });
      }
      const date = text(body.date, 10);
      const start = text(body.start, 40);
      const end = text(body.end, 40);
      if (!date || !start || !end) return json({ ok: false, error: 'new_slot_required' }, 400);
      const calendar = await bookingAction(context, { id: requestId, action: 'reschedule', date, start, end });
      if (!calendar.data.ok) {
        return json(
          { ok: false, error: calendar.data.error ?? 'slot_unavailable', calendarStatus: calendar.status },
          calendar.status === 200 ? 409 : calendar.status,
        );
      }
      const slot = (calendar.data.slot ?? {}) as Record<string, unknown>;
      const newStart = String(slot.start ?? start);
      const newEnd = String(slot.end ?? end);
      const duration = Number(slot.durationMinutes) || Number(row.duration_minutes) || 120;
      const statements = [
        db
          .prepare('UPDATE appointments SET start_at = ?, end_at = ?, duration_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(newStart, newEnd, duration, appointmentId),
        db
          .prepare('UPDATE booking_requests SET requested_date = ?, start_at = ?, end_at = ?, duration_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(date, newStart, newEnd, duration, requestId),
      ];
      try {
        if (db.batch) await db.batch(statements);
        else for (const statement of statements) await statement.run();
      } catch {
        const eventId = String(row.calendar_event_id ?? '');
        if (eventId && row.start_at && row.end_at) {
          await updateCalendarEvent(context.env, eventId, {
            start: String(row.start_at),
            end: String(row.end_at),
            timeZone: branchTimeZone(row.branch_id),
          }).catch(() => undefined);
        }
        return json({ ok: false, error: 'reschedule_recovery_required' }, 502);
      }
      await audit(db, {
        actorUserId: actor.id,
        action: 'request.appointment_rescheduled',
        entityType: 'booking_request',
        entityId: requestId,
        detail: `${date} ${newStart} - ${newEnd}`,
      });
      const email = body.notify === false
        ? { status: 'skipped_not_requested', recipient: false }
        : await sendForRequest(context, db, actor, row, 'reschedule', {
            dateLabel: dateLabel(newStart, row.branch_id),
            timeLabel: timeLabel(newStart, newEnd, row.branch_id),
          });
      return json({ ok: true, slot, email });
    }

    if (action === 'notify') {
      const requested = text(body.kind, 20) as BookingEmailKind;
      const kind: BookingEmailKind =
        requested === 'confirmation' || requested === 'decline' || requested === 'proposal' || requested === 'reschedule' || requested === 'cancellation'
          ? requested
          : String(row.status) === 'confirmed'
            ? 'confirmation'
            : String(row.status) === 'declined'
              ? 'decline'
              : 'proposal';
      const email = await sendForRequest(context, db, actor, row, kind, {
        reason: text(row.decline_reason, 500),
      });
      return json({ ok: true, email });
    }

    if (action === 'status') {
      const status = text(body.status, 20);
      if (status === 'declined' || status === 'released') {
        if (manualBooking) {
          try {
            await cancelManualBooking(context.env, db, actor, requestId, `Status changed to ${status}`);
            if (status === 'declined') {
              await updateRequestStatus(db, actor, requestId, 'declined');
            }
            return json({ ok: true });
          } catch (error) {
            return json(
              { ok: false, error: error instanceof AdminAuthError ? error.code : 'calendar_release_failed' },
              error instanceof AdminAuthError ? error.status : 502,
            );
          }
        }
        const calendar = await bookingAction(context, {
          id: requestId,
          action: status === 'declined' ? 'decline' : 'release',
        });
        if (!calendar.data.ok) {
          return json(
            { ok: false, error: calendar.data.error ?? 'calendar_release_failed', calendarStatus: calendar.status },
            calendar.status === 200 ? 502 : calendar.status,
          );
        }
      }
      await updateRequestStatus(db, actor, requestId, status);
      return json({ ok: true });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'request_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
