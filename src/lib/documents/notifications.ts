// Durable owner notification for a fully executed document bundle.
//
// The executed copy is preserved in D1 before this module runs. Email is a
// side effect: a provider failure never loses the signed record, and the
// outbox row is retried idempotently by request id plus executed-copy SHA-256.

import type { D1Database } from '../admin/d1.ts';
import { bytesToBase64 } from '../forms/owner-email.ts';

export interface ExecutedDocumentEmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  OWNER_NOTIFICATION_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
}

const EVENT_TYPE = 'executed_document_email';

interface ExecutedRequest {
  id: string;
  status: string;
  bundle_code: string;
  bundle_version: number;
  subject_type: string;
  subject_name: string;
  branch_name: string;
  executed_copy_text: string;
  executed_sha256: string;
  executed_at: string | null;
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
      `SELECT sr.id, sr.status, sr.bundle_code, sr.bundle_version, sr.subject_type,
              sr.executed_copy_text, sr.executed_sha256, sr.executed_at,
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
  const to = env.OWNER_NOTIFICATION_EMAIL?.trim() || 'owner@sparkling-standard.com';
  const subject = `Executed agreement - ${request.subject_name} - ${request.bundle_code || 'documents'}`;
  const attachmentName = `executed-${request.id}.txt`;
  const attachment = bytesToBase64(new TextEncoder().encode(request.executed_copy_text));
  const summary = [
    `Customer/employee: ${request.subject_name}`,
    `Branch: ${request.branch_name || 'not assigned'}`,
    `Bundle: ${request.bundle_code} v${request.bundle_version}`,
    `Executed at: ${request.executed_at ?? 'recorded'}`,
    `Executed copy SHA-256: ${request.executed_sha256}`,
    '',
    'The executed copy is attached. The immutable record remains in the Sparkling Standard documents system.',
  ].join('\n');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': outbox.idempotency_key.slice(0, 200),
      },
      body: JSON.stringify({
        from:
          env.RESEND_FROM_EMAIL?.trim() ||
          'Sparkling Standard <notifications@sparkling-standard.com>',
        to: [to],
        subject,
        text: summary,
        html: `<p><strong>Executed document completed</strong></p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(summary)}</pre>`,
        attachments: [{ filename: attachmentName, content: attachment }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { sent: false, error: `provider_${response.status}` };
    return { sent: true, error: '' };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.name : 'provider_unavailable',
    };
  }
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
