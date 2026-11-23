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
  reviewContextForAppointment,
} from '../../../src/lib/reviews/service.ts';
import { sendReviewRequestEmail, type ReviewEmailEnv } from '../../../src/lib/reviews/email.ts';

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
      const result = await queueReviewForAppointment(db, appointmentId);
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
