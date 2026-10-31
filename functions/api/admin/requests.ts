import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf, type AdminActor } from '../../../src/lib/admin/operations.ts';
import {
  assertRequestConfirmable,
  attachCalendarEvent,
  confirmRequest,
  updateAppointmentStatus,
  updateRequestStatus,
} from '../../../src/lib/admin/scheduling.ts';
import { createCustomer, getCustomer } from '../../../src/lib/admin/crm.ts';
import type { BookingEnv } from '../../../src/lib/booking/service.ts';
import { onRequestPost as bookingAdminPost } from '../booking-admin.ts';
import { sendBookingEmail, type BookingEmailKind } from '../../../src/lib/forms/booking-email.ts';

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

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});

function dateLabel(value: unknown): string {
  const date = new Date(String(value ?? ''));
  return Number.isFinite(date.getTime()) ? DATE_FORMAT.format(date) : '';
}

function timeLabel(start: unknown, end: unknown): string {
  const first = new Date(String(start ?? ''));
  const second = new Date(String(end ?? ''));
  if (!Number.isFinite(first.getTime())) return '';
  if (!Number.isFinite(second.getTime())) return TIME_FORMAT.format(first);
  return `${TIME_FORMAT.format(first)} – ${TIME_FORMAT.format(second)} Central`;
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
  const outcome = await sendBookingEmail(
    {
      ...(context.env.RESEND_API_KEY ? { RESEND_API_KEY: context.env.RESEND_API_KEY } : {}),
      ...(context.env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: context.env.RESEND_FROM_EMAIL } : {}),
      ...(context.env.RESEND_REPLY_TO ? { RESEND_REPLY_TO: context.env.RESEND_REPLY_TO } : {}),
      PUBLIC_SITE_URL: context.env.PUBLIC_SITE_URL ?? new URL(context.request.url).origin,
    },
    email,
    {
      kind,
      reference: String(row.quote_reference ?? row.id ?? ''),
      ...(customerName ? { customerName } : {}),
      dateLabel: overrides.dateLabel ?? dateLabel(row.start_at),
      timeLabel: overrides.timeLabel ?? timeLabel(row.start_at, row.end_at),
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
    const leadScope = scoped(actor, 'l.branch_id');
    const view = text(url.searchParams.get('view') ?? 'actionable', 20) || 'actionable';
    const query = text(url.searchParams.get('q'), 100);
    const lifecycle: Record<string, string> = {
      actionable:
        " AND r.archived_at IS NULL AND r.closed_at IS NULL AND (r.status = 'pending' OR (r.status = 'confirmed' AND (a.status IS NULL OR a.status IN ('pending','confirmed','in_progress'))))",
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
    const [requests, appointments, reservationLeads] = await Promise.all([
      db.prepare(
        `SELECT r.id, r.customer_id, r.status, r.quote_reference, r.requested_date, r.start_at, r.end_at,
                r.duration_minutes, r.payload_json, r.created_at, r.closed_at, r.closed_reason,
                r.archived_at, r.duplicate_of_request_id, r.previous_status,
                c.first_name, c.last_name, p.line1, p.city, p.state, p.postal_code,
                a.id AS appointment_id, a.status AS appointment_status,
                (SELECT provider_event_id FROM calendar_links cl WHERE cl.appointment_id = a.id
                 ORDER BY cl.last_synced_at DESC LIMIT 1) AS calendar_event_id
         FROM booking_requests r
         LEFT JOIN customers c ON c.id = r.customer_id
         LEFT JOIN properties p ON p.id = r.property_id
         LEFT JOIN appointments a ON a.booking_request_id = r.id
         WHERE 1 = 1 ${requestScope.sql} ${lifecycleSql} ${searchSql}
         ORDER BY r.start_at ASC, r.created_at DESC LIMIT 200`,
      ).bind(...requestScope.bind, ...searchBind).all(),
      db.prepare(
        `SELECT a.id, a.status, a.start_at, a.end_at, a.reference, a.crew_size, a.source,
                c.first_name, c.last_name, p.line1, p.city
         FROM appointments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN properties p ON p.id = a.property_id
         WHERE 1 = 1 ${appointmentScope.sql}
         ORDER BY a.start_at ASC LIMIT 200`,
      ).bind(...appointmentScope.bind).all(),
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
  const [contacts, properties, notifications, auditRows, pending] = await Promise.all([
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
    const requestId = text(body.requestId, 120);
    if (!requestId) return json({ ok: false, error: 'request_required' }, 400);
    const row = await requestRow(db, actor, requestId);
    if (!row) return json({ ok: false, error: 'request_not_found' }, 404);

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
      const released = await bookingAction(context, { id: requestId, action: 'release' });
      if (!released.data.ok) {
        return json({ ok: false, error: released.data.error ?? 'hold_release_failed', calendarStatus: released.status }, released.status === 200 ? 502 : released.status);
      }
      const reason = text(body.reason, 500) || (duplicateOf ? 'Duplicate request' : 'Closed by staff');
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
      await assertRequestConfirmable(db, actor, requestId);
      const calendar = await bookingAction(context, { id: requestId, action: 'confirm' });
      if (!calendar.data.ok) {
        return json(
          { ok: false, error: calendar.data.error ?? 'calendar_confirm_failed', calendarStatus: calendar.status },
          calendar.status === 200 ? 502 : calendar.status,
        );
      }
      const teamMemberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.map((value) => String(value)).filter(Boolean).slice(0, 12)
        : [];
      try {
        const result = await confirmRequest(db, actor, requestId, teamMemberIds);
        const eventId = String(calendar.data.eventId ?? '');
        if (eventId) await attachCalendarEvent(db, result.appointmentId, eventId);
        const confirmedRow = await requestRow(db, actor, requestId);
        const email = confirmedRow
          ? await sendForRequest(context, db, actor, confirmedRow, 'confirmation')
          : { status: 'skipped_no_email', recipient: false };
        return json({ ok: true, ...result, calendarEventId: eventId || null, email });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof AdminAuthError ? error.code : 'd1_confirm_failed',
            calendarConfirmed: true,
            calendarEventId: calendar.data.eventId ?? null,
          },
          error instanceof AdminAuthError ? error.status : 502,
        );
      }
    }

    if (action === 'decline') {
      const reason = text(body.reason, 500);
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
        dateLabel: dateLabel(newStart),
        timeLabel: timeLabel(newStart, newEnd),
      });
      return json({ ok: true, slot, email });
    }

    if (action === 'reschedule' || action === 'cancel') {
      const appointmentId = (row.appointment_id as string | null) ?? '';
      if (!appointmentId) return json({ ok: false, error: 'appointment_not_found' }, 409);
      const reason = text(body.reason, 500);
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
      await db
        .prepare('UPDATE appointments SET start_at = ?, end_at = ?, duration_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(newStart, newEnd, duration, appointmentId)
        .run();
      await db
        .prepare('UPDATE booking_requests SET requested_date = ?, start_at = ?, end_at = ?, duration_minutes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(date, newStart, newEnd, duration, requestId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'request.appointment_rescheduled',
        entityType: 'booking_request',
        entityId: requestId,
        detail: `${date} ${newStart} - ${newEnd}`,
      });
      const email = await sendForRequest(context, db, actor, row, 'reschedule', {
        dateLabel: dateLabel(newStart),
        timeLabel: timeLabel(newStart, newEnd),
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
