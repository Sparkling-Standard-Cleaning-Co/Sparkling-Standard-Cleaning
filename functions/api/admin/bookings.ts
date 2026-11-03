// Owner/staff manual estimate and one-time booking API (BOOK-09).
//
// GET  /api/admin/bookings?view=context&customerId=<id>
// GET  /api/admin/bookings?view=availability&customerId=&propertyId=&date=&durationMinutes=&crewSize=
// GET  /api/admin/bookings?view=commitments
// POST /api/admin/bookings { action: 'quote' | 'create' | 'confirm' | 'cancel' | 'reschedule' | 'invoice' }
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  audit,
  requireActor,
  requireCsrf,
  type AdminActor,
} from '../../../src/lib/admin/operations.ts';
import {
  cancelManualBooking,
  confirmManualBooking,
  createManualBooking,
  manualAvailability,
  quoteManualBooking,
  rescheduleManualBooking,
  type ManualBookingEnv,
} from '../../../src/lib/admin/manual-booking.ts';
import { createInvoice } from '../../../src/lib/admin/billing.ts';
import { createInvoicePaymentLink, type StripeBillingEnv } from '../../../src/lib/admin/stripe-billing.ts';
import { assertRequestConfirmable, confirmRequest } from '../../../src/lib/admin/scheduling.ts';
import {
  getBookingCommitmentByReference,
  markBookingCommitment,
} from '../../../src/lib/booking/commitments.ts';
import { getCalendarEvent } from '../../../src/lib/booking/google-calendar.ts';

interface Env extends AdminDbEnv, ManualBookingEnv, StripeBillingEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function scope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

async function contextFor(
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: AdminActor,
  customerId: string,
): Promise<Record<string, unknown>> {
  const branch = scope(actor, 'c.primary_branch_id');
  const customer = await db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, c.primary_branch_id,
              (SELECT value FROM customer_contacts ct WHERE ct.customer_id = c.id AND ct.kind = 'email'
                ORDER BY ct.is_primary DESC LIMIT 1) AS email,
              (SELECT value FROM customer_contacts ct WHERE ct.customer_id = c.id AND ct.kind = 'phone'
                ORDER BY ct.is_primary DESC LIMIT 1) AS phone
       FROM customers c WHERE c.id = ? ${branch.sql} LIMIT 1`,
    )
    .bind(customerId, ...branch.bind)
    .first<Record<string, unknown>>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  const properties = await db
    .prepare(
      `SELECT id, label, line1, line2, city, state, postal_code, latitude, longitude, precision,
              property_type, square_feet, bedrooms, full_baths, half_baths, stories, beds, pets,
              access_notes, parking_notes, is_primary, status
       FROM properties WHERE customer_id = ? AND status = 'active'
       ORDER BY is_primary DESC, created_at ASC LIMIT 50`,
    )
    .bind(customerId)
    .all();
  return { customer, properties: properties.results ?? [] };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const url = new URL(context.request.url);
    const view = text(url.searchParams.get('view'), 30) || 'context';
    if (view === 'commitments') {
      const actor = await requireActor(db, context.request, 'booking.read');
      const branch = scope(actor, 'r.branch_id');
      const rows = await db
        .prepare(
          `SELECT bc.*, r.status AS request_status, r.quote_reference, r.start_at,
                  c.first_name, c.last_name
           FROM booking_commitments bc
           LEFT JOIN booking_requests r ON r.id = bc.booking_request_id
           LEFT JOIN customers c ON c.id = r.customer_id
           WHERE bc.state IN ('failed','calendar_created','pending') ${branch.sql.replace('r.branch_id', 'r.branch_id')}
           ORDER BY bc.updated_at DESC LIMIT 100`,
        )
        .bind(...branch.bind)
        .all();
      return json({ ok: true, commitments: rows.results ?? [] });
    }
    if (view === 'availability') {
      const actor = await requireActor(db, context.request, 'booking.write');
      const availability = await manualAvailability(context.env, db, actor, {
        customerId: url.searchParams.get('customerId') ?? '',
        propertyId: url.searchParams.get('propertyId') ?? '',
        date: url.searchParams.get('date') ?? '',
        durationMinutes: url.searchParams.get('durationMinutes') ?? '',
        crewSize: url.searchParams.get('crewSize') ?? '',
        teamMemberIds: (url.searchParams.get('teamMemberIds') ?? '').split(',').filter(Boolean),
      });
      return json({ ok: true, availability });
    }
    const actor = await requireActor(db, context.request, 'booking.read');
    const customerId = text(url.searchParams.get('customerId'), 100);
    if (!customerId) return json({ ok: false, error: 'customer_required' }, 400);
    return json({ ok: true, ...(await contextFor(db, actor, customerId)) });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'booking_context_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

async function invoiceForRequest(
  env: Env,
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: AdminActor,
  requestId: string,
  paymentLinkRequested: boolean,
): Promise<Record<string, unknown>> {
  const row = await db
    .prepare(
      `SELECT r.*, a.id AS appointment_id, e.total_cents, e.service_code, e.labor_hours
       FROM booking_requests r
       LEFT JOIN appointments a ON a.booking_request_id = r.id
       LEFT JOIN estimates e ON e.quote_reference = r.quote_reference
       WHERE r.id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'request_not_found');
  if (!row.customer_id) throw new AdminAuthError(400, 'request_customer_incomplete');
  const total = Number(row.total_cents);
  if (!Number.isFinite(total) || total <= 0) throw new AdminAuthError(409, 'request_not_priced');
  const existing = row.appointment_id
    ? await db.prepare('SELECT id, number FROM invoices WHERE appointment_id = ? LIMIT 1').bind(String(row.appointment_id)).first<{ id: string; number: string }>()
    : null;
  const invoice = existing
    ? { id: existing.id, number: existing.number, totalCents: total }
    : await createInvoice(db, actor, {
        customerId: String(row.customer_id),
        propertyId: row.property_id ?? undefined,
        appointmentId: row.appointment_id ?? undefined,
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
        lines: [
          {
            kind: 'service',
            description: `Cleaning service — ${String(row.quote_reference ?? requestId)}`,
            quantity: 1,
            unitAmountCents: total,
            totalCents: total,
          },
        ],
        notes: 'Preliminary manual booking invoice. Tax and any final adjustment are confirmed on the final invoice.',
      });
  let paymentLink: Record<string, unknown> | null = null;
  let paymentLinkError = '';
  if (paymentLinkRequested) {
    try {
      paymentLink = { ...(await createInvoicePaymentLink(db, actor, invoice.id, env)) };
    } catch (error) {
      paymentLinkError = error instanceof AdminAuthError ? error.code : 'payment_link_failed';
    }
  }
  await audit(db, {
    actorUserId: actor.id,
    action: 'booking.manual_invoice',
    entityType: 'invoice',
    entityId: invoice.id,
    detail: `${requestId}:${paymentLinkRequested ? 'link' : 'no_link'}:${paymentLinkError}`,
  });
  return { invoice, ...(paymentLink ? { paymentLink } : {}), ...(paymentLinkError ? { paymentLinkError } : {}) };
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    if (!['quote', 'create', 'confirm', 'cancel', 'reschedule', 'invoice', 'reconcile'].includes(action)) {
      return json({ ok: false, error: 'invalid_action' }, 400);
    }
    const permission = action === 'invoice' ? 'finance.write' : 'booking.write';
    const actor = await requireActor(db, context.request, permission);
    requireCsrf(context.request, actor);

    if (action === 'reconcile') {
      const requestId = text(body.requestId, 120);
      const row = await db
        .prepare(
          `SELECT r.*, a.id AS appointment_id FROM booking_requests r
           LEFT JOIN appointments a ON a.booking_request_id = r.id WHERE r.id = ? LIMIT 1`,
        )
        .bind(requestId)
        .first<Record<string, unknown>>();
      if (!row) throw new AdminAuthError(404, 'request_not_found');
      if (actor.role !== 'owner' && row.branch_id && actor.branchId && row.branch_id !== actor.branchId) {
        throw new AdminAuthError(403, 'forbidden');
      }
      const teamMemberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.filter((value): value is string => typeof value === 'string')
        : [];
      if (String(row.hold_id ?? '').startsWith('manual_')) {
        const result = await confirmManualBooking(context.env, db, actor, requestId, teamMemberIds);
        return json({ ok: true, ...result, reconciled: true });
      }
      const reference = String(row.quote_reference ?? '');
      const commitment = await getBookingCommitmentByReference(db, reference);
      if (row.appointment_id) {
        if (commitment) {
          await markBookingCommitment(db, commitment.id, 'confirmed', {
            appointmentId: String(row.appointment_id),
          });
        }
        return json({ ok: true, alreadyConfirmed: true, appointmentId: String(row.appointment_id), reference });
      }
      if (!commitment?.calendarEventId) {
        return json({ ok: false, error: 'nothing_to_reconcile' }, 409);
      }
      const event = await getCalendarEvent(context.env, commitment.calendarEventId).catch(() => null);
      if (!event || event.status === 'cancelled') {
        await markBookingCommitment(db, commitment.id, 'failed', {
          error: 'calendar_event_missing_or_cancelled',
        }).catch(() => undefined);
        return json({ ok: false, error: 'calendar_event_missing_or_cancelled' }, 409);
      }
      await assertRequestConfirmable(db, actor, requestId);
      const result = await confirmRequest(
        db,
        actor,
        requestId,
        teamMemberIds,
        commitment.calendarEventId,
      );
      await markBookingCommitment(db, commitment.id, 'confirmed', {
        eventId: commitment.calendarEventId,
        appointmentId: result.appointmentId,
        attempts: commitment.attempts + 1,
      });
      await audit(db, {
        actorUserId: actor.id,
        action: 'booking.reconciled',
        entityType: 'appointment',
        entityId: result.appointmentId,
        detail: reference,
      });
      return json({ ok: true, ...result, reconciled: true });
    }

    if (action === 'quote') {
      return json({ ok: true, quote: await quoteManualBooking(context.env, db, actor, body) });
    }
    if (action === 'create') {
      const created = await createManualBooking(context.env, db, actor, body);
      return json({ ok: true, ...created }, 201);
    }
    if (action === 'confirm') {
      const teamMemberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.filter((value): value is string => typeof value === 'string')
        : [];
      const confirmed = await confirmManualBooking(
        context.env,
        db,
        actor,
        text(body.requestId, 120),
        teamMemberIds,
      );
      return json({ ok: true, ...confirmed });
    }
    if (action === 'cancel') {
      const cancelled = await cancelManualBooking(
        context.env,
        db,
        actor,
        text(body.requestId, 120),
        text(body.reason, 500),
      );
      return json({ ...cancelled, ok: true });
    }
    if (action === 'reschedule') {
      const rescheduled = await rescheduleManualBooking(context.env, db, actor, text(body.requestId, 120), {
        date: text(body.date, 10),
        start: text(body.start, 40),
        end: text(body.end, 40),
        ...(Number(body.durationMinutes) ? { durationMinutes: Number(body.durationMinutes) } : {}),
        teamMemberIds: Array.isArray(body.teamMemberIds)
          ? body.teamMemberIds.filter((value): value is string => typeof value === 'string')
          : [],
      });
      return json({ ...rescheduled, ok: true });
    }
    return json({
      ok: true,
      ...(await invoiceForRequest(
        context.env,
        db,
        actor,
        text(body.requestId, 120),
        body.paymentLink === true,
      )),
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'booking_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
