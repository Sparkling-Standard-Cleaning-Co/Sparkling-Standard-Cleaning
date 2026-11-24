import type { D1Database } from '../admin/d1.ts';
import { branchConfig } from '../../config/branches.ts';

export type ReviewRequestStatus = 'queued' | 'sent' | 'suppressed' | 'failed' | 'cancelled';

export interface ReviewContext {
  branchId: string;
  branchName: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  appointmentId: string;
  invoiceId: string;
  appointmentStatus: string;
  source: string;
  reviewUrl: string;
  enabled: boolean;
  delayHours: number;
  maxPerCustomer: number;
}

export interface ReviewEligibility {
  eligible: boolean;
  reason: string;
  scheduledAt: string;
  dedupeKey: string;
}

export interface ReviewRequestRow extends Record<string, unknown> {
  id: string;
  branch_id: string;
  customer_id: string | null;
  appointment_id: string | null;
  invoice_id: string | null;
  status: ReviewRequestStatus;
  recipient: string;
  review_url: string;
  scheduled_at: string;
  sent_at: string | null;
  suppressed_reason: string;
  dedupe_key: string;
  created_at: string;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function now(): string {
  return new Date().toISOString();
}

function normalizeReviewUrl(value: unknown): string {
  const url = text(value, 500);
  return /^https:\/\//i.test(url) ? url : '';
}

function normalizeContext(row: Record<string, unknown>): ReviewContext | null {
  const branchId = text(row.branch_id, 80);
  const branch = branchConfig(branchId);
  if (!branchId || !branch) return null;
  return {
    branchId,
    branchName: branch.publicName,
    customerId: text(row.customer_id, 100),
    customerName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
    customerEmail: text(row.customer_email, 200).toLowerCase(),
    appointmentId: text(row.appointment_id, 100),
    invoiceId: text(row.invoice_id, 100),
    appointmentStatus: text(row.appointment_status, 40),
    source: text(row.source, 80).toLowerCase(),
    reviewUrl: normalizeReviewUrl(row.review_url),
    enabled: Number(row.review_requests_enabled ?? 0) === 1,
    delayHours: Math.max(1, Number(row.review_request_delay_hours ?? 24) || 24),
    maxPerCustomer: Math.max(1, Number(row.review_request_max_per_customer ?? 1) || 1),
  };
}

export async function reviewContextForAppointment(
  db: D1Database,
  appointmentId: string,
): Promise<ReviewContext | null> {
  const row = await db
    .prepare(
      `SELECT a.id AS appointment_id, a.customer_id, a.branch_id, a.status AS appointment_status,
              a.source,
              c.first_name, c.last_name,
              (SELECT value FROM customer_contacts
               WHERE customer_contacts.customer_id = c.id AND customer_contacts.kind = 'email'
               ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS customer_email,
              b.review_url, b.review_requests_enabled, b.review_request_delay_hours,
              b.review_request_max_per_customer
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN branches b ON b.id = a.branch_id
       WHERE a.id = ? LIMIT 1`,
    )
    .bind(appointmentId)
    .first<Record<string, unknown>>();
  return row ? normalizeContext(row) : null;
}

export async function reviewContextForInvoice(
  db: D1Database,
  invoiceId: string,
): Promise<ReviewContext | null> {
  const row = await db
    .prepare(
      `SELECT i.id AS invoice_id, i.customer_id, i.branch_id, i.appointment_id,
              a.status AS appointment_status, a.source,
              c.first_name, c.last_name,
              (SELECT value FROM customer_contacts
               WHERE customer_contacts.customer_id = c.id AND customer_contacts.kind = 'email'
               ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS customer_email,
              b.review_url, b.review_requests_enabled, b.review_request_delay_hours,
              b.review_request_max_per_customer
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.id = ? LIMIT 1`,
    )
    .bind(invoiceId)
    .first<Record<string, unknown>>();
  return row ? normalizeContext(row) : null;
}

/** Invoice review invitation: completed service plus a real branch review link. */
export function invoiceReviewInvitation(context: ReviewContext | null): {
  url: string;
  eligible: boolean;
  branchName: string;
} | undefined {
  if (!context) return undefined;
  if (context.appointmentStatus !== 'completed') return undefined;
  if (context.source.includes('test') || context.source.includes('preview')) return undefined;
  if (!context.reviewUrl) return undefined;
  return { url: context.reviewUrl, eligible: true, branchName: context.branchName };
}

export function reviewEligibility(
  context: ReviewContext | null,
  options: { now?: Date | undefined; existingCount?: number | undefined; allowDisabled?: boolean | undefined } = {},
): ReviewEligibility {
  const empty = (reason: string): ReviewEligibility => ({
    eligible: false,
    reason,
    scheduledAt: '',
    dedupeKey: '',
  });
  if (!context) return empty('review_context_missing');
  if (!context.enabled && options.allowDisabled !== true) return empty('branch_review_requests_disabled');
  if (!context.reviewUrl) return empty('review_url_missing');
  if (!context.appointmentId) return empty('appointment_missing');
  if (context.appointmentStatus !== 'completed') return empty('service_not_completed');
  if (context.source.includes('test') || context.source.includes('preview')) return empty('test_record');
  if (!context.customerEmail) return empty('customer_email_missing');
  if ((options.existingCount ?? 0) >= context.maxPerCustomer) return empty('frequency_cap');
  const base = options.now ?? new Date();
  const scheduledAt = new Date(base.getTime() + context.delayHours * 3_600_000).toISOString();
  return {
    eligible: true,
    reason: 'eligible',
    scheduledAt,
    dedupeKey: `review:${context.branchId}:${context.customerId}:${context.appointmentId}`,
  };
}

export async function queueReviewRequest(
  db: D1Database,
  context: ReviewContext | null,
  options: { now?: Date | undefined; force?: boolean | undefined; allowDisabled?: boolean | undefined } = {},
): Promise<{ queued: boolean; id?: string; reason: string; scheduledAt?: string }> {
  if (!context) return { queued: false, reason: 'review_context_missing' };
  const baseDedupeKey = context.appointmentId
    ? `review:${context.branchId}:${context.customerId}:${context.appointmentId}`
    : '';
  if (baseDedupeKey) {
    const existing = await db
      .prepare('SELECT id, status, scheduled_at FROM review_requests WHERE dedupe_key = ? LIMIT 1')
      .bind(baseDedupeKey)
      .first<{ id: string; status: string; scheduled_at: string }>();
    if (existing) {
      return {
        queued: existing.status === 'queued',
        id: existing.id,
        reason: existing.status === 'queued' ? 'already_queued' : `already_${existing.status}`,
        scheduledAt: existing.scheduled_at,
      };
    }
  }
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM review_requests
       WHERE customer_id = ? AND branch_id = ? AND status IN ('queued','sent') AND created_at >= ?`,
    )
    .bind(context.customerId, context.branchId, since)
    .first<{ count: number }>();
  const eligibility = reviewEligibility(context, {
    now: options.now,
    existingCount: Number(count?.count ?? 0),
    allowDisabled: options.allowDisabled === true,
  });
  if (!eligibility.eligible && !options.force) {
    return { queued: false, reason: eligibility.reason };
  }
  const id = `rev_${crypto.randomUUID()}`;
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO review_requests
       (id, branch_id, customer_id, appointment_id, invoice_id, status, channel, recipient,
        review_url, scheduled_at, suppressed_reason, dedupe_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      context.branchId,
      context.customerId,
      context.appointmentId || null,
      context.invoiceId || null,
      'queued',
      context.customerEmail,
      context.reviewUrl,
      eligibility.scheduledAt,
      '',
      eligibility.dedupeKey,
      timestamp,
      timestamp,
    )
    .run();
  return { queued: true, id, reason: 'queued', scheduledAt: eligibility.scheduledAt };
}

export async function queueReviewForAppointment(
  db: D1Database,
  appointmentId: string,
  options: { allowDisabled?: boolean | undefined } = {},
): Promise<{ queued: boolean; id?: string; reason: string }> {
  const context = await reviewContextForAppointment(db, appointmentId);
  return queueReviewRequest(db, context, options);
}

export async function listReviewRequests(
  db: D1Database,
  input: { branchId?: string; status?: string; limit?: number } = {},
): Promise<ReviewRequestRow[]> {
  const limit = Math.min(100, Math.max(1, Math.round(input.limit ?? 50)));
  const branchId = text(input.branchId, 80);
  const status = text(input.status, 40);
  const rows = await db
    .prepare(
      `SELECT rr.id, rr.branch_id, rr.customer_id, rr.appointment_id, rr.invoice_id, rr.status,
              rr.recipient, rr.review_url, rr.scheduled_at, rr.sent_at, rr.suppressed_reason,
              rr.dedupe_key, rr.created_at,
              c.first_name, c.last_name,
              a.start_at AS appointment_start,
              p.line1, p.city,
              b.name AS branch_name,
              e.service_code
       FROM review_requests rr
       LEFT JOIN customers c ON c.id = rr.customer_id
       LEFT JOIN appointments a ON a.id = rr.appointment_id
       LEFT JOIN properties p ON p.id = a.property_id
       LEFT JOIN branches b ON b.id = rr.branch_id
       LEFT JOIN estimates e ON e.id = a.estimate_id
       WHERE (? = '' OR rr.branch_id = ?) AND (? = '' OR rr.status = ?)
       ORDER BY rr.created_at DESC LIMIT ?`,
    )
    .bind(branchId, branchId, status, status, limit)
    .all<ReviewRequestRow>();
  return rows.results ?? [];
}

export async function cancelReviewRequest(
  db: D1Database,
  id: string,
  reason = 'cancelled_by_owner',
): Promise<void> {
  await db
    .prepare(
      `UPDATE review_requests SET status = 'cancelled', suppressed_reason = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued','failed')`,
    )
    .bind(text(reason, 300), now(), id)
    .run();
}

export async function markReviewRequestSent(
  db: D1Database,
  id: string,
  status: 'sent' | 'failed',
  errorDetail = '',
): Promise<void> {
  await db
    .prepare(
      `UPDATE review_requests SET status = ?, sent_at = ?, error_detail = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .bind(status, status === 'sent' ? now() : null, text(errorDetail, 500), now(), id)
    .run();
}

export async function recordReviewDelivery(
  db: D1Database,
  input: { requestId: string; recipient: string; status: 'sent' | 'failed' | 'suppressed'; error?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notification_delivery_events
       (id, event_key, department, channel, recipient, status, provider, error_code,
        attempts, related_type, related_id, created_at, updated_at)
       VALUES (?, 'review_request', 'customerService', 'email', ?, ?, 'resend', ?,
               1, 'review_request', ?, ?, ?)`,
    )
    .bind(
      `review_delivery_${crypto.randomUUID()}`,
      text(input.recipient, 200),
      input.status,
      text(input.error ?? '', 200),
      input.requestId,
      now(),
      now(),
    )
    .run()
    .catch(() => undefined);
}
