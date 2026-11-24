import type { D1Database } from '../admin/d1.ts';
import { audit } from '../admin/operations.ts';
import {
  markReviewRequestSent,
  recordReviewDelivery,
  reviewContextForAppointment,
} from './service.ts';
import { sendReviewRequestEmail, type ReviewEmailEnv } from './email.ts';

export interface ReviewDeliveryEnv extends ReviewEmailEnv {}

export interface ReviewDeliveryResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Sends due automation-created review invitations only.
 *
 * Safety properties:
 * - Requires the branch automation switch to still be enabled.
 * - Never touches a request that is already sent, cancelled or failed.
 * - Only processes requests whose scheduled time is due and recent, so turning
 *   automation on later cannot silently flush an old backlog.
 * - Reuses the deterministic review-request idempotency key.
 */
export async function processDueReviewRequests(
  db: D1Database,
  env: ReviewDeliveryEnv,
  options: { now?: Date; limit?: number; maxDueAgeHours?: number } = {},
): Promise<ReviewDeliveryResult> {
  const now = options.now ?? new Date();
  const limit = Math.min(50, Math.max(1, Math.round(options.limit ?? 20)));
  const maxDueAgeHours = Math.min(168, Math.max(1, Number(options.maxDueAgeHours ?? 6)));
  const newestDue = now.toISOString();
  const oldestDue = new Date(now.getTime() - maxDueAgeHours * 3_600_000).toISOString();
  const due = await db
    .prepare(
      `SELECT id, appointment_id, recipient
       FROM review_requests
       WHERE status = 'queued' AND scheduled_at <= ? AND scheduled_at >= ?
       ORDER BY scheduled_at ASC LIMIT ?`,
    )
    .bind(newestDue, oldestDue, limit)
    .all<{ id: string; appointment_id: string | null; recipient: string }>();

  const result: ReviewDeliveryResult = { scanned: 0, sent: 0, failed: 0, skipped: 0 };
  for (const request of due.results ?? []) {
    result.scanned += 1;
    const context = request.appointment_id
      ? await reviewContextForAppointment(db, request.appointment_id)
      : null;
    if (!context || !context.enabled || !context.customerEmail || !context.reviewUrl || context.appointmentStatus !== 'completed') {
      result.skipped += 1;
      continue;
    }
    const outcome = await sendReviewRequestEmail({
      to: context.customerEmail,
      customerName: context.customerName,
      branchName: context.branchName,
      reviewUrl: context.reviewUrl,
      env,
      idempotencyKey: `review-${request.id}`,
    });
    if (outcome === 'sent') {
      await markReviewRequestSent(db, request.id, 'sent');
      await recordReviewDelivery(db, {
        requestId: request.id,
        recipient: request.recipient || context.customerEmail,
        status: 'sent',
      });
      result.sent += 1;
    } else {
      const error = outcome === 'skipped_not_configured' ? 'resend_not_configured' : 'provider_failed';
      await markReviewRequestSent(db, request.id, 'failed', error);
      await recordReviewDelivery(db, {
        requestId: request.id,
        recipient: request.recipient || context.customerEmail,
        status: outcome === 'skipped_not_configured' ? 'suppressed' : 'failed',
        error,
      });
      result.failed += 1;
    }
    await audit(db, {
      actorUserId: null,
      action: outcome === 'sent' ? 'review.request_sent' : 'review.request_failed',
      entityType: 'review_request',
      entityId: request.id,
      detail: `automation:${outcome}`,
    }).catch(() => undefined);
  }
  return result;
}
