// Admin review-request management. Review automation is owner-gated; this
// endpoint lists the queue and lets an owner queue or cancel a request for a
// verified completed appointment. It never invents a review URL.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  audit,
  requireActor,
  requireCsrf,
  requireStepUp,
} from '../../../src/lib/admin/operations.ts';
import {
  cancelReviewRequest,
  listReviewRequests,
  markReviewRequestSent,
  queueReviewForAppointment,
  recordReviewDelivery,
  reviewContextForAppointment,
} from '../../../src/lib/reviews/service.ts';
import { buildReviewRequestEmail, sendReviewRequestEmail, type ReviewEmailEnv } from '../../../src/lib/reviews/email.ts';

interface Env extends AdminDbEnv, ReviewEmailEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'settings.write');
    const url = new URL(context.request.url);
    const branchId = actor.role === 'owner' ? (url.searchParams.get('branchId') ?? '') : actor.branchId ?? '';
    const status = url.searchParams.get('status') ?? '';
    if (url.searchParams.get('view') === 'preview') {
      const appointmentId = (url.searchParams.get('appointmentId') ?? '').trim();
      if (!appointmentId) return json({ ok: false, error: 'appointment_required' }, 400);
      const reviewContext = await reviewContextForAppointment(db, appointmentId);
      if (!reviewContext) return json({ ok: false, error: 'review_context_missing' }, 404);
      if (!reviewContext.reviewUrl) return json({ ok: false, error: 'review_url_missing' }, 409);
      const email = buildReviewRequestEmail({
        customerName: reviewContext.customerName,
        branchName: reviewContext.branchName,
        reviewUrl: reviewContext.reviewUrl,
      });
      return json({ ok: true, ...email, recipient: reviewContext.customerEmail, branchName: reviewContext.branchName });
    }
    if (url.searchParams.get('view') === 'eligible') {
      const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
      const scope = actor.role === 'owner'
        ? { sql: '', bind: [] as unknown[] }
        : actor.branchId
          ? { sql: ' AND a.branch_id = ?', bind: [actor.branchId] }
          : { sql: ' AND 1 = 0', bind: [] as unknown[] };
      const search = query
        ? ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR p.line1 LIKE ? OR p.city LIKE ?)`
        : '';
      const searchBind = query ? Array.from({ length: 4 }, () => `%${query}%`) : [];
      const rows = await db
        .prepare(
          `SELECT a.id, a.start_at, a.status, a.customer_id, a.branch_id,
                  c.first_name, c.last_name,
                  (SELECT value FROM customer_contacts
                   WHERE customer_contacts.customer_id = c.id AND customer_contacts.kind = 'email'
                   ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS customer_email,
                  p.line1, p.city, p.state, p.postal_code,
                  e.service_code, COALESCE(NULLIF(e.input_snapshot_json, ''), '{}') AS input_snapshot_json,
                  b.name AS branch_name, b.review_url, b.review_requests_enabled,
                  (SELECT rr.id FROM review_requests rr WHERE rr.appointment_id = a.id
                    ORDER BY rr.created_at DESC LIMIT 1) AS latest_request_id,
                  (SELECT rr.status FROM review_requests rr WHERE rr.appointment_id = a.id
                    ORDER BY rr.created_at DESC LIMIT 1) AS latest_status,
                  (SELECT rr.sent_at FROM review_requests rr WHERE rr.appointment_id = a.id
                    ORDER BY rr.created_at DESC LIMIT 1) AS latest_sent_at,
                  (SELECT rr.suppressed_reason FROM review_requests rr WHERE rr.appointment_id = a.id
                    ORDER BY rr.created_at DESC LIMIT 1) AS latest_reason,
                  (SELECT COUNT(*) FROM review_requests rr
                    WHERE rr.customer_id = a.customer_id AND rr.status = 'sent') AS customer_sent_count
           FROM appointments a
           LEFT JOIN customers c ON c.id = a.customer_id
           LEFT JOIN properties p ON p.id = a.property_id
           LEFT JOIN estimates e ON e.id = a.estimate_id
           LEFT JOIN branches b ON b.id = a.branch_id
           WHERE a.status = 'completed'${scope.sql}${search}
           ORDER BY a.start_at DESC LIMIT 100`,
        )
        .bind(...scope.bind, ...searchBind)
        .all<Record<string, unknown>>();
      return json({ ok: true, appointments: rows.results ?? [], branchId });
    }
    const requests = await listReviewRequests(db, { branchId, status, limit: 100 });
    return json({ ok: true, requests, branchId });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'reviews_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'settings.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'queue') {
      const appointmentId = String(body.appointmentId ?? '').trim();
      if (!appointmentId) return json({ ok: false, error: 'appointment_required' }, 400);
      const result = await queueReviewForAppointment(db, appointmentId, {
        allowDisabled: actor.role === 'owner',
      });
      await audit(db, {
        actorUserId: actor.id,
        action: 'review.request_queued',
        entityType: 'appointment',
        entityId: appointmentId,
        detail: result.reason,
      });
      return json({ ok: true, ...result }, result.queued ? 200 : 409);
    }
    if (action === 'cancel') {
      const id = String(body.id ?? '').trim();
      if (!id) return json({ ok: false, error: 'review_request_required' }, 400);
      await cancelReviewRequest(db, id, String(body.reason ?? 'cancelled_by_owner'));
      await audit(db, {
        actorUserId: actor.id,
        action: 'review.request_cancelled',
        entityType: 'review_request',
        entityId: id,
      });
      return json({ ok: true });
    }
    if (action === 'send') {
      requireStepUp(actor);
      const id = String(body.id ?? '').trim();
      if (!id) return json({ ok: false, error: 'review_request_required' }, 400);
      const row = await db
        .prepare(
          `SELECT id, branch_id, appointment_id, recipient, status, review_url
           FROM review_requests WHERE id = ? LIMIT 1`,
        )
        .bind(id)
        .first<Record<string, unknown>>();
      if (!row) return json({ ok: false, error: 'review_request_not_found' }, 404);
      if (String(row.status) !== 'queued') return json({ ok: false, error: 'review_request_not_queued' }, 409);
      const reviewContext = await reviewContextForAppointment(db, String(row.appointment_id ?? ''));
      if (!reviewContext || !reviewContext.customerEmail) {
        return json({ ok: false, error: 'review_context_missing' }, 409);
      }
      const result = await sendReviewRequestEmail({
        to: reviewContext.customerEmail,
        customerName: reviewContext.customerName,
        branchName: reviewContext.branchName,
        reviewUrl: reviewContext.reviewUrl,
        env: context.env,
        idempotencyKey: `review-${id}`,
      });
      await markReviewRequestSent(db, id, result === 'sent' ? 'sent' : 'failed', result === 'sent' ? '' : result);
      await recordReviewDelivery(db, {
        requestId: id,
        recipient: reviewContext.customerEmail,
        status: result === 'sent' ? 'sent' : result === 'skipped_not_configured' ? 'suppressed' : 'failed',
        error: result === 'sent' ? '' : result,
      });
      await audit(db, {
        actorUserId: actor.id,
        action: 'review.request_sent',
        entityType: 'review_request',
        entityId: id,
        detail: result,
      });
      return json({ ok: result === 'sent', result }, result === 'sent' ? 200 : 502);
    }
    return json({ ok: false, error: 'review_action_invalid' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'review_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
