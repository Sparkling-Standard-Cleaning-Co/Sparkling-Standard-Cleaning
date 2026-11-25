// Durable owner notification for a fully executed document bundle.
//
// The executed copy is preserved in D1 before this module runs. Email is a
// side effect: a provider failure never loses the signed record, and the
// outbox row is retried idempotently by request id plus executed-copy SHA-256.

import type { D1Database } from '../admin/d1.ts';
import { bytesToBase64 } from '../forms/owner-email.ts';
import {
  defaultCommunicationSettings,
  notificationRecipients,
  readCommunicationSettings,
  recordNotificationDelivery,
} from '../admin/communications.ts';
import { EMAIL_ROUTING } from '../../config/email-routing.ts';
import { sendAdminEmailDetailed } from '../admin/email.ts';

export interface ExecutedDocumentEmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  OWNER_NOTIFICATION_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
  DOCUMENTS_BUCKET?: {
    get?: (key: string) => Promise<{
      arrayBuffer?: () => Promise<ArrayBuffer>;
      httpMetadata?: { contentType?: string };
    } | null>;
  };
}

const EVENT_TYPE = 'executed_document_email';

interface ExecutedRequest {
  id: string;
  status: string;
  bundle_code: string;
  bundle_version: number;
  packet_name: string;
  subject_type: string;
  subject_name: string;
  branch_name: string;
  executed_copy_text: string;
  executed_sha256: string;
  executed_at: string | null;
  signer_email: string;
  executed_r2_key: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function requestFor(db: D1Database, requestId: string): Promise<ExecutedRequest | null> {
  return db
    .prepare(
       `SELECT sr.id, sr.status, sr.bundle_code, sr.bundle_version, sr.packet_name, sr.subject_type,
              sr.executed_copy_text, sr.executed_sha256, sr.executed_at, sr.signer_email,
              (SELECT ds.r2_key FROM document_signatures ds
                WHERE ds.signing_request_id = sr.id AND TRIM(ds.r2_key) <> ''
                ORDER BY ds.signed_at DESC LIMIT 1) AS executed_r2_key,
              COALESCE(
                NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
                tm.display_name, 'Customer'
              ) AS subject_name,
              COALESCE(b.name, '') AS branch_name
       FROM signing_requests sr
       LEFT JOIN customers c ON c.id = sr.customer_id
       LEFT JOIN team_members tm ON tm.id = sr.team_member_id
       LEFT JOIN branches b ON b.id = sr.branch_id
       WHERE sr.id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<ExecutedRequest>();
}

/**
 * Queue one owner notification for a fully executed bundle. Safe to call
 * repeatedly: the unique idempotency key prevents duplicate emails.
 */
export async function queueExecutedDocumentEmail(
  db: D1Database,
  requestId: string,
): Promise<{ queued: boolean; reason: string }> {
  const request = await requestFor(db, requestId);
  if (!request || request.status !== 'signed') return { queued: false, reason: 'not_signed' };
  if (!request.executed_copy_text || !request.executed_sha256) {
    return { queued: false, reason: 'executed_copy_unavailable' };
  }
  const pendingReview = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM document_signatures WHERE signing_request_id = ? AND status = 'awaiting_verification'",
    )
    .bind(requestId)
    .first<{ count: number }>();
  if (Number(pendingReview?.count ?? 0) > 0) {
    return { queued: false, reason: 'awaiting_verification' };
  }
  const idempotencyKey = `documents.executed:${request.id}:${request.executed_sha256}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO outbox_events
       (id, aggregate_type, aggregate_id, event_type, payload_json, idempotency_key, status, available_at)
       VALUES (?, 'signing_request', ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
    )
    .bind(
      `outbox_${crypto.randomUUID()}`,
      request.id,
      EVENT_TYPE,
      JSON.stringify({
        requestId: request.id,
        bundleCode: request.bundle_code,
        subjectName: request.subject_name,
        branchName: request.branch_name,
        executedSha256: request.executed_sha256,
      }),
      idempotencyKey,
    )
    .run();
  return { queued: true, reason: 'queued' };
}

async function sendOwnerEmail(
  db: D1Database,
  env: ExecutedDocumentEmailEnv,
  outbox: {
    id: string;
    aggregate_id: string;
    idempotency_key: string;
    attempts: number;
  },
): Promise<{ sent: boolean; error: string }> {
  const request = await requestFor(db, outbox.aggregate_id);
  if (!request || request.status !== 'signed' || !request.executed_copy_text) {
    return { sent: false, error: 'executed_copy_unavailable' };
  }
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return { sent: false, error: 'email_not_configured' };
  const settingsState = await readCommunicationSettings(db).catch(() => null);
  const settings = settingsState?.settings ?? defaultCommunicationSettings();
  let recipients = notificationRecipients(settings, 'document_executed');
  if (recipients.length === 0) {
    recipients = [
      {
        department: 'owner',
        address: env.OWNER_NOTIFICATION_EMAIL?.trim() || EMAIL_ROUTING.owner,
      },
    ];
  }
  const agreementName = String(request.packet_name || 'Executed agreement').trim() || 'Executed agreement';
  const subject = `Executed agreement - ${request.subject_name} - ${agreementName}`;
  const safeSubject = request.subject_name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'customer';
  const attachmentName = `executed-agreement-${safeSubject}.txt`;
  const attachment = bytesToBase64(new TextEncoder().encode(request.executed_copy_text));
  const summary = [
    `Customer/employee: ${request.subject_name}`,
    `Agreement: ${agreementName}`,
    `Branch: ${request.branch_name || 'not assigned'}`,
    `Executed: ${request.executed_at ?? 'recorded'}`,
    '',
    'The executed copy is attached. The signed record and audit evidence are retained privately in the Sparkling Standard documents system.',
  ].join('\n');
  const html = `<p><strong>Executed document completed</strong></p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(summary)}</pre>`;
  let allDelivered = true;
  let lastError = '';
  for (const recipient of recipients) {
    const outcome = await sendAdminEmailDetailed(
      env,
      recipient.address,
      { subject, html, text: summary },
      `${outbox.idempotency_key}/${recipient.department}`,
      {
        attachments: [{ filename: attachmentName, content: attachment, contentType: 'text/plain' }],
      },
    );
    if (!outcome.ok) {
      allDelivered = false;
      lastError = outcome.error || 'provider_unavailable';
    }
    await recordNotificationDelivery(db, {
      eventKey: 'document_executed',
      department: recipient.department,
      recipient: recipient.address,
      status: outcome.ok ? 'sent' : outcome.error === 'not_configured' ? 'suppressed' : 'failed',
      providerId: outcome.providerId,
      errorCode: outcome.ok ? '' : outcome.error,
      relatedType: 'signing_request',
      relatedId: request.id,
    }).catch(() => undefined);
  }
  return { sent: allDelivered, error: allDelivered ? '' : lastError };
}

const CUSTOMER_EVENT_TYPE = 'executed_document_customer';

export type CustomerExecutedEmailStatus = {
  status: 'sent' | 'failed' | 'suppressed' | 'already_sent' | 'not_configured' | 'unavailable';
  providerId?: string;
  reason?: string;
};

/**
 * Sends the executed PDF to the customer's bound signing email address.
 *
 * The PDF is read from private document storage, never generated from a
 * browser value. A previously accepted delivery is reused, so a retry cannot
 * create a second customer message.
 */
export async function sendCustomerExecutedCopy(
  db: D1Database,
  env: ExecutedDocumentEmailEnv,
  requestId: string,
): Promise<CustomerExecutedEmailStatus> {
  const request = await requestFor(db, requestId);
  if (!request || request.status !== 'signed') {
    return { status: 'unavailable', reason: 'not_signed' };
  }
  const email = String(request.signer_email ?? '').trim().toLowerCase();
  if (!email) return { status: 'unavailable', reason: 'customer_email_missing' };
  const previous = await db
    .prepare(
      `SELECT status, provider_id FROM notification_delivery_events
       WHERE event_key = ? AND related_id = ? AND department = 'customer'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(CUSTOMER_EVENT_TYPE, requestId)
    .first<{ status: string; provider_id: string | null }>()
    .catch(() => null);
  if (previous && ['sent', 'delivered'].includes(String(previous.status))) {
    return { status: 'already_sent', ...(previous.provider_id ? { providerId: previous.provider_id } : {}) };
  }
  if (!env.RESEND_API_KEY?.trim()) return { status: 'not_configured' };
  const key = String(request.executed_r2_key ?? '');
  if (!key || !env.DOCUMENTS_BUCKET?.get) {
    return { status: 'unavailable', reason: 'executed_pdf_missing' };
  }
  const object = await env.DOCUMENTS_BUCKET.get(key).catch(() => null);
  const bytes = object?.arrayBuffer ? await object.arrayBuffer().catch(() => null) : null;
  if (!bytes || bytes.byteLength === 0) {
    return { status: 'unavailable', reason: 'executed_pdf_unreadable' };
  }
  const agreementName = String(request.packet_name || 'Executed agreement').trim() || 'Executed agreement';
  const subject = `Your signed agreement - ${agreementName}`;
  const summary = [
    `Your signed Sparkling Standard agreement is attached.`,
    `Agreement: ${agreementName}`,
    `Customer: ${request.subject_name}`,
    `Executed: ${request.executed_at ?? 'recorded'}`,
    '',
    'Keep this copy for your records. Your signed record and audit evidence are retained privately by Sparkling Standard.',
  ].join('\n');
  const html = `<p><strong>Your signed agreement is attached.</strong></p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(summary)}</pre>`;
  const outcome = await sendAdminEmailDetailed(
    env,
    email,
    { subject, html, text: summary },
    `documents.customer-executed:${requestId}:${request.executed_sha256}`,
    {
      attachments: [
        {
          filename: `${agreementName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'executed-agreement'}.pdf`,
          content: bytesToBase64(new Uint8Array(bytes)),
          contentType: 'application/pdf',
        },
      ],
    },
  );
  const status: CustomerExecutedEmailStatus = outcome.ok
    ? { status: 'sent', ...(outcome.providerId ? { providerId: outcome.providerId } : {}) }
    : outcome.error === 'not_configured'
      ? { status: 'not_configured' }
      : { status: 'failed', reason: outcome.error || 'provider_unavailable' };
  await recordNotificationDelivery(db, {
    eventKey: CUSTOMER_EVENT_TYPE,
    department: 'customer',
    recipient: email,
    status: outcome.ok ? 'sent' : outcome.error === 'not_configured' ? 'suppressed' : 'failed',
    providerId: outcome.providerId,
    errorCode: outcome.ok ? '' : outcome.error,
    relatedType: 'signing_request',
    relatedId: requestId,
  }).catch(() => undefined);
  return status;
}

export async function customerExecutedEmailStatus(
  db: D1Database,
  requestId: string,
): Promise<CustomerExecutedEmailStatus | null> {
  const row = await db
    .prepare(
      `SELECT status, provider_id, error_code FROM notification_delivery_events
       WHERE event_key = ? AND related_id = ? AND department = 'customer'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(CUSTOMER_EVENT_TYPE, requestId)
    .first<{ status: string; provider_id: string | null; error_code: string | null }>()
    .catch(() => null);
  if (!row) return null;
  const status = String(row.status);
  if (status === 'sent' || status === 'delivered') {
    return {
      status: 'sent',
      ...(row.provider_id ? { providerId: String(row.provider_id) } : {}),
    };
  }
  if (status === 'suppressed') return { status: 'not_configured' };
  return {
    status: 'failed',
    ...(row.error_code ? { reason: String(row.error_code) } : {}),
  };
}

/**
 * Process pending/failed executed-document emails. Called immediately after
 * signing and again whenever the owner opens/retries the documents area.
 */
export async function processExecutedDocumentOutbox(
  db: D1Database,
  env: ExecutedDocumentEmailEnv,
  options: { requestId?: string; limit?: number } = {},
): Promise<{ processed: number; sent: number; failed: number; pending: number }> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);
  const rows = await db
    .prepare(
      `SELECT id, aggregate_id, idempotency_key, attempts
       FROM outbox_events
       WHERE event_type = ? AND status IN ('pending','failed')
         AND available_at <= CURRENT_TIMESTAMP
         ${options.requestId ? 'AND aggregate_id = ?' : ''}
       ORDER BY created_at LIMIT ?`,
    )
    .bind(EVENT_TYPE, ...(options.requestId ? [options.requestId] : []), limit)
    .all<{ id: string; aggregate_id: string; idempotency_key: string; attempts: number }>();
  let processed = 0;
  let sent = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    processed += 1;
    await db
      .prepare("UPDATE outbox_events SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(row.id)
      .run()
      .catch(() => undefined);
    const outcome = await sendOwnerEmail(db, env, row);
    if (outcome.sent) {
      sent += 1;
      await db
        .prepare(
          `UPDATE outbox_events SET status = 'completed', attempts = attempts + 1,
             last_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(row.id)
        .run();
    } else {
      failed += 1;
      await db
        .prepare(
          `UPDATE outbox_events SET status = 'failed', attempts = attempts + 1,
             last_error = ?, available_at = datetime(CURRENT_TIMESTAMP, '+15 minutes'),
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(outcome.error.slice(0, 200), row.id)
        .run();
    }
  }
  const pendingRow = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM outbox_events
       WHERE event_type = ? AND status IN ('pending','failed','processing')`,
    )
    .bind(EVENT_TYPE)
    .first<{ count: number }>();
  return { processed, sent, failed, pending: Number(pendingRow?.count ?? 0) };
}

export async function executedDocumentEmailStatus(
  db: D1Database,
  requestId: string,
): Promise<{ status: string; attempts: number; lastError: string } | null> {
  return db
    .prepare(
      `SELECT status, attempts, last_error FROM outbox_events
       WHERE event_type = ? AND aggregate_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(EVENT_TYPE, requestId)
    .first<{ status: string; attempts: number; last_error: string }>()
    .then((row) =>
      row
        ? { status: row.status, attempts: Number(row.attempts), lastError: row.last_error }
        : null,
    );
}
