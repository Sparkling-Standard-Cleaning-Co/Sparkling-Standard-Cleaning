import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit } from '../admin/operations.ts';
import { branchConfig } from '../../config/branches.ts';

export type ReviewRequestStatus = 'queued' | 'sent' | 'suppressed' | 'failed' | 'cancelled';

export type CustomerReviewStatus =
  | 'never_invited'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'reviewed'
  | 'do_not_ask'
  | 'opted_out';

const CUSTOMER_REVIEW_STATUSES = new Set<string>([
  'never_invited',
  'queued',
  'sent',
  'failed',
  'unknown',
  'reviewed',
  'do_not_ask',
  'opted_out',
]);

const SUPPRESSING_REVIEW_STATUSES = new Set<CustomerReviewStatus>([
  'reviewed',
  'do_not_ask',
  'opted_out',
]);

export interface CustomerReviewState {
  customerId: string;
  branchId: string | null;
  status: CustomerReviewStatus;
  invitationCount: number;
  lastInvitedAt: string | null;
  lastRequestId: string | null;
  markedReviewedAt: string | null;
  source: string;
  note: string;
  updatedAt: string;
}

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
  customerReviewStatus?: CustomerReviewStatus;
  customerReviewInvitationCount?: number;
  customerReviewLastInvitedAt?: string | null;
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

export function normalizeCustomerReviewStatus(value: unknown): CustomerReviewStatus {
  const raw = text(value, 40);
  return CUSTOMER_REVIEW_STATUSES.has(raw) ? (raw as CustomerReviewStatus) : 'never_invited';
}

export function customerReviewSuppressed(status: CustomerReviewStatus): boolean {
  return SUPPRESSING_REVIEW_STATUSES.has(status);
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
    customerReviewStatus: normalizeCustomerReviewStatus(row.customer_review_status),
    customerReviewInvitationCount: Math.max(0, Number(row.customer_review_invitation_count ?? 0) || 0),
    customerReviewLastInvitedAt: text(row.customer_review_last_invited_at, 40) || null,
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
              b.review_request_max_per_customer,
              COALESCE(crs.status, 'never_invited') AS customer_review_status,
              COALESCE(crs.invitation_count,
                (SELECT COUNT(*) FROM review_requests rr
                 WHERE rr.customer_id = c.id AND rr.status = 'sent')) AS customer_review_invitation_count,
              crs.last_invited_at AS customer_review_last_invited_at
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN branches b ON b.id = a.branch_id
       LEFT JOIN customer_review_state crs ON crs.customer_id = c.id
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
              b.review_request_max_per_customer,
              COALESCE(crs.status, 'never_invited') AS customer_review_status,
              COALESCE(crs.invitation_count,
                (SELECT COUNT(*) FROM review_requests rr
                 WHERE rr.customer_id = c.id AND rr.status = 'sent')) AS customer_review_invitation_count,
              crs.last_invited_at AS customer_review_last_invited_at
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN appointments a ON a.id = i.appointment_id
       LEFT JOIN branches b ON b.id = i.branch_id
       LEFT JOIN customer_review_state crs ON crs.customer_id = c.id
       WHERE i.id = ? LIMIT 1`,
    )
    .bind(invoiceId)
    .first<Record<string, unknown>>();
  return row ? normalizeContext(row) : null;
}

/**
 * Invoice review invitation: completed service, a real branch review link, and
 * a customer who has never been invited or already declined suppression.
 */
export function invoiceReviewInvitation(context: ReviewContext | null): {
  url: string;
  eligible: boolean;
  branchName: string;
} | undefined {
  if (!context) return undefined;
  if (context.appointmentStatus !== 'completed') return undefined;
  if (context.source.includes('test') || context.source.includes('preview')) return undefined;
  if (!context.reviewUrl) return undefined;
  const status = context.customerReviewStatus ?? 'never_invited';
  if (customerReviewSuppressed(status)) return undefined;
  if (status === 'queued' || status === 'sent' || status === 'unknown') return undefined;
  if ((context.customerReviewInvitationCount ?? 0) > 0) return undefined;
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
  const status = context.customerReviewStatus ?? 'never_invited';
  if (status === 'reviewed') return empty('already_reviewed');
  if (status === 'do_not_ask') return empty('customer_do_not_ask');
  if (status === 'opted_out') return empty('customer_opted_out');
  if (status === 'unknown') return empty('review_status_unknown');
  const invitedCount = Math.max(options.existingCount ?? 0, context.customerReviewInvitationCount ?? 0);
  if (invitedCount >= context.maxPerCustomer) return empty('frequency_cap');
  if (invitedCount > 0 && context.customerReviewLastInvitedAt) {
    const last = Date.parse(context.customerReviewLastInvitedAt);
    const base = options.now ?? new Date();
    if (Number.isFinite(last) && base.getTime() - last < 30 * 86_400_000) {
      return empty('recent_invitation');
    }
  }
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
  options: {
    now?: Date | undefined;
    force?: boolean | undefined;
    allowDisabled?: boolean | undefined;
    source?: 'automation' | 'owner';
  } = {},
): Promise<{ queued: boolean; id?: string; reason: string; scheduledAt?: string }> {
  if (!context) return { queued: false, reason: 'review_context_missing' };
  const state = await customerReviewState(db, context.customerId).catch(() => null);
  const effective: ReviewContext = state
    ? {
        ...context,
        customerReviewStatus: state.status,
        customerReviewInvitationCount: state.invitationCount,
        customerReviewLastInvitedAt: state.lastInvitedAt,
      }
    : context;
  const baseDedupeKey = effective.appointmentId
    ? `review:${effective.branchId}:${effective.customerId}:${effective.appointmentId}`
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
    .bind(effective.customerId, effective.branchId, since)
    .first<{ count: number }>();
  const eligibility = reviewEligibility(effective, {
    now: options.now,
    existingCount: state ? state.invitationCount : Number(count?.count ?? 0),
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
      effective.branchId,
      effective.customerId,
      effective.appointmentId || null,
      effective.invoiceId || null,
      'queued',
      effective.customerEmail,
      effective.reviewUrl,
      eligibility.scheduledAt,
      '',
      eligibility.dedupeKey,
      timestamp,
      timestamp,
    )
    .run();
  await markCustomerReviewQueued(db, {
    customerId: effective.customerId,
    branchId: effective.branchId,
    requestId: id,
    source: options.source ?? 'automation',
  });
  return { queued: true, id, reason: 'queued', scheduledAt: eligibility.scheduledAt };
}

export async function queueReviewForAppointment(
  db: D1Database,
  appointmentId: string,
  options: { allowDisabled?: boolean | undefined; source?: 'automation' | 'owner' } = {},
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
  const request = await db
    .prepare('SELECT customer_id, branch_id FROM review_requests WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ customer_id: string | null; branch_id: string | null }>();
  const timestamp = now();
  await db
    .prepare(
      `UPDATE review_requests SET status = ?, sent_at = ?, error_detail = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .bind(status, status === 'sent' ? timestamp : null, text(errorDetail, 500), timestamp, id)
    .run();
  if (!request?.customer_id) return;
  await markCustomerReviewDelivery(db, {
    customerId: request.customer_id,
    branchId: request.branch_id,
    requestId: id,
    status,
  }).catch(() => undefined);
}

export async function customerReviewState(
  db: D1Database,
  customerId: string,
): Promise<CustomerReviewState | null> {
  const id = text(customerId, 100);
  if (!id) return null;
  const row = await db
    .prepare('SELECT * FROM customer_review_state WHERE customer_id = ? LIMIT 1')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    customerId: id,
    branchId: text(row.branch_id, 80) || null,
    status: normalizeCustomerReviewStatus(row.status),
    invitationCount: Math.max(0, Number(row.invitation_count ?? 0) || 0),
    lastInvitedAt: text(row.last_invited_at, 40) || null,
    lastRequestId: text(row.last_request_id, 100) || null,
    markedReviewedAt: text(row.marked_reviewed_at, 40) || null,
    source: text(row.source, 40) || 'owner',
    note: text(row.note, 500),
    updatedAt: text(row.updated_at, 40),
  };
}

async function markCustomerReviewQueued(
  db: D1Database,
  input: { customerId: string; branchId: string; requestId: string; source: 'automation' | 'owner' },
): Promise<void> {
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO customer_review_state
         (customer_id, branch_id, status, invitation_count, last_request_id, source, created_at, updated_at)
       VALUES (?, ?, 'queued', 0, ?, ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         branch_id = excluded.branch_id,
         status = CASE WHEN customer_review_state.status IN ('reviewed','do_not_ask','opted_out')
                       THEN customer_review_state.status ELSE 'queued' END,
         last_request_id = excluded.last_request_id,
         updated_at = excluded.updated_at`,
    )
    .bind(input.customerId, input.branchId, input.requestId, input.source, timestamp, timestamp)
    .run();
}

async function markCustomerReviewDelivery(
  db: D1Database,
  input: { customerId: string; branchId: string | null; requestId: string; status: 'sent' | 'failed' },
): Promise<void> {
  const timestamp = now();
  if (input.status === 'sent') {
    await db
      .prepare(
        `INSERT INTO customer_review_state
           (customer_id, branch_id, status, invitation_count, last_invited_at, last_request_id, source, created_at, updated_at)
         VALUES (?, ?, 'sent', 1, ?, ?, 'delivery', ?, ?)
         ON CONFLICT(customer_id) DO UPDATE SET
           branch_id = COALESCE(excluded.branch_id, customer_review_state.branch_id),
           status = CASE WHEN customer_review_state.status IN ('reviewed','do_not_ask','opted_out')
                         THEN customer_review_state.status ELSE 'sent' END,
           invitation_count = customer_review_state.invitation_count + 1,
           last_invited_at = excluded.last_invited_at,
           last_request_id = excluded.last_request_id,
           updated_at = excluded.updated_at`,
      )
      .bind(input.customerId, input.branchId, timestamp, input.requestId, timestamp, timestamp)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO customer_review_state
         (customer_id, branch_id, status, invitation_count, last_request_id, source, created_at, updated_at)
       VALUES (?, ?, 'failed', 0, ?, 'delivery', ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         branch_id = COALESCE(excluded.branch_id, customer_review_state.branch_id),
         status = CASE WHEN customer_review_state.status IN ('sent','reviewed','do_not_ask','opted_out')
                       THEN customer_review_state.status ELSE 'failed' END,
         last_request_id = excluded.last_request_id,
         updated_at = excluded.updated_at`,
    )
    .bind(input.customerId, input.branchId, input.requestId, timestamp, timestamp)
    .run();
}

export type CustomerReviewAction =
  | 'mark_reviewed'
  | 'mark_unknown'
  | 'mark_eligible'
  | 'do_not_ask'
  | 'opt_out'
  | 'clear';

/** Owner-controlled customer review suppression. Never fabricates a review. */
export async function setCustomerReviewState(
  db: D1Database,
  actorUserId: string,
  customerId: string,
  action: CustomerReviewAction,
  options: { note?: string; branchId?: string } = {},
): Promise<CustomerReviewState | null> {
  const id = text(customerId, 100);
  if (!id) throw new AdminAuthError(400, 'customer_required');
  const customer = await db
    .prepare('SELECT id, primary_branch_id FROM customers WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ id: string; primary_branch_id: string | null }>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  const note = text(options.note, 500);
  const branchId = text(options.branchId, 80) || customer.primary_branch_id || null;
  if (action === 'clear') {
    await db.prepare('DELETE FROM customer_review_state WHERE customer_id = ?').bind(id).run();
    await audit(db, {
      actorUserId,
      action: 'review.customer_state_cleared',
      entityType: 'customer',
      entityId: id,
    });
    return null;
  }
  const status: CustomerReviewStatus =
    action === 'mark_reviewed'
      ? 'reviewed'
      : action === 'do_not_ask'
        ? 'do_not_ask'
        : action === 'opt_out'
          ? 'opted_out'
          : action === 'mark_unknown'
            ? 'unknown'
            : 'never_invited';
  const timestamp = now();
  const resetInvitations = action === 'mark_eligible';
  await db
    .prepare(
      `INSERT INTO customer_review_state
         (customer_id, branch_id, status, invitation_count, last_invited_at, last_request_id,
          marked_reviewed_at, marked_by_admin_user_id, source, note, created_at, updated_at)
       VALUES (?, ?, ?, 0, NULL, NULL, ?, ?, 'owner', ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         branch_id = COALESCE(excluded.branch_id, customer_review_state.branch_id),
         status = excluded.status,
         invitation_count = CASE WHEN ? = 1 THEN 0 ELSE customer_review_state.invitation_count END,
         last_invited_at = CASE WHEN ? = 1 THEN NULL ELSE customer_review_state.last_invited_at END,
         last_request_id = CASE WHEN ? = 1 THEN NULL ELSE customer_review_state.last_request_id END,
         marked_reviewed_at = excluded.marked_reviewed_at,
         marked_by_admin_user_id = excluded.marked_by_admin_user_id,
         source = 'owner',
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      branchId,
      status,
      status === 'reviewed' ? timestamp : null,
      actorUserId,
      note,
      timestamp,
      timestamp,
      resetInvitations ? 1 : 0,
      resetInvitations ? 1 : 0,
      resetInvitations ? 1 : 0,
    )
    .run();
  await audit(db, {
    actorUserId,
    action: `review.customer_state_${action}`,
    entityType: 'customer',
    entityId: id,
    detail: note,
  });
  return customerReviewState(db, id);
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
