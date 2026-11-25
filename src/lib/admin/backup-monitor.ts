// Backup heartbeat evaluation, incident escalation and critical alert delivery.
//
// This module is shared by the internal backup-status endpoint and the
// scheduled backup-monitor Worker. A successful provider request only proves
// the alert was accepted; it never proves inbox delivery or backup restorability.

import { audit } from './operations.ts';
import type { D1Database } from './d1.ts';
import {
  DEPARTMENT_ADDRESSES,
  readCommunicationSettings,
  recordNotificationDelivery,
  renderTemplate,
} from './communications.ts';

export interface BackupMonitorEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
}

export interface BackupHealthInput {
  lastSuccessAt: string | null;
  lastRunStatus?: 'success' | 'failure' | null;
  now?: Date;
  staleHours?: number;
  escalationMinutes?: number;
  incidentOpenedAt?: string | null;
  escalationSentAt?: string | null;
}

export interface BackupHealth {
  status: 'healthy' | 'stale' | 'missing' | 'failed';
  ageHours: number | null;
  shouldAlert: boolean;
  shouldEscalate: boolean;
}

export function evaluateBackupHealth(input: BackupHealthInput): BackupHealth {
  const now = input.now ?? new Date();
  const staleHours = Math.min(Math.max(Number(input.staleHours) || 26, 1), 168);
  const escalationMinutes = Math.min(Math.max(Number(input.escalationMinutes) || 30, 5), 1440);
  const parsed = input.lastSuccessAt ? new Date(input.lastSuccessAt) : null;
  const valid = parsed && Number.isFinite(parsed.getTime());
  const ageHours = valid ? (now.getTime() - parsed.getTime()) / 3_600_000 : null;
  const status: BackupHealth['status'] = input.lastRunStatus === 'failure'
    ? 'failed'
    : !valid
      ? 'missing'
      : ageHours! > staleHours
        ? 'stale'
        : 'healthy';
  const unhealthy = status !== 'healthy';
  const opened = input.incidentOpenedAt ? new Date(input.incidentOpenedAt).getTime() : null;
  const shouldEscalate = Boolean(
    unhealthy &&
      opened &&
      Number.isFinite(opened) &&
      !input.escalationSentAt &&
      now.getTime() - opened >= escalationMinutes * 60_000,
  );
  return { status, ageHours, shouldAlert: unhealthy, shouldEscalate };
}

export async function latestSuccessfulBackup(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT recorded_at FROM backup_runs WHERE status = 'success' ORDER BY recorded_at DESC LIMIT 1")
    .first<{ recorded_at: string }>();
  return row?.recorded_at ?? null;
}

export async function recordBackupRun(
  db: D1Database,
  input: {
    runKey: string;
    status: 'success' | 'failure';
    summary?: string;
    detail?: Record<string, unknown>;
    startedAt?: string;
    finishedAt?: string;
  },
): Promise<{ recorded: true; incidentResolved: boolean }> {
  if (!/^[A-Za-z0-9_.:-]{3,160}$/.test(input.runKey)) throw new Error('backup_run_key_invalid');
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO backup_runs (id, run_key, status, summary, detail_json, started_at, finished_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_key) DO UPDATE SET
         status = excluded.status,
         summary = excluded.summary,
         detail_json = excluded.detail_json,
         finished_at = excluded.finished_at,
         recorded_at = excluded.recorded_at`,
    )
    .bind(
      `backup_${crypto.randomUUID()}`,
      input.runKey,
      input.status,
      String(input.summary ?? '').slice(0, 1000),
      JSON.stringify(input.detail ?? {}).slice(0, 4000),
      input.startedAt ?? null,
      input.finishedAt ?? now,
      now,
    )
    .run();
  // Incident resolution belongs to the monitor tick so the recovery notice is
  // delivered exactly once through the same audited alert path.
  const incidentResolved = false;
  await audit(db, {
    actorUserId: null,
    action: input.status === 'success' ? 'backup.run_succeeded' : 'backup.run_failed',
    entityType: 'backup_run',
    entityId: input.runKey,
    detail: String(input.summary ?? '').slice(0, 200),
  }).catch(() => undefined);
  return { recorded: true, incidentResolved };
}

interface DeliveryResult {
  sent: boolean;
  recipient: string;
}

async function sendAlert(
  db: D1Database,
  env: BackupMonitorEnv,
  department: 'admin' | 'owner',
  subject: string,
  text: string,
  relatedId: string,
): Promise<DeliveryResult> {
  const recipient = DEPARTMENT_ADDRESSES[department];
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    await recordNotificationDelivery(db, {
      eventKey: 'backup_failure',
      department,
      recipient,
      status: 'suppressed',
      errorCode: 'resend_not_configured',
      relatedType: 'backup_incident',
      relatedId,
    }).catch(() => undefined);
    return { sent: false, recipient };
  }
  let sent = false;
  let providerId = '';
  let errorCode = '';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `backup-alert-${relatedId}-${department}-${new Date().toISOString()}`.slice(0, 200),
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || 'Sparkling Standard <notifications@sparkling-standard.com>',
        to: [recipient],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    sent = response.ok;
    providerId = payload.id ?? '';
    if (!response.ok) errorCode = payload.message ?? `http_${response.status}`;
  } catch (error) {
    errorCode = error instanceof Error ? error.name : 'network_error';
  }
  await recordNotificationDelivery(db, {
    eventKey: 'backup_failure',
    department,
    recipient,
    status: sent ? 'sent' : 'failed',
    providerId,
    errorCode,
    relatedType: 'backup_incident',
    relatedId,
  }).catch(() => undefined);
  return { sent, recipient };
}

function alertText(settingsEscalationMinutes: number, detail: string, occurredAt: string): string {
  return [
    `A backup failure or missed backup was detected at ${occurredAt}.`,
    '',
    detail,
    '',
    `Owner escalation occurs after ${settingsEscalationMinutes} minutes without a successful run.`,
    'Do not treat the backup as verified until an independent restore rehearsal succeeds.',
    '',
    'Sparkling Standard Operations',
  ].join('\n');
}

export interface BackupTickResult {
  status: BackupHealth['status'];
  action:
    | 'none'
    | 'alerted_admin_and_owner'
    | 'escalated_owner'
    | 'resolved_recovery'
    | 'resolved_without_notice';
  incidentId?: string;
}

export async function backupMonitorTick(
  db: D1Database,
  env: BackupMonitorEnv,
  nowInput: Date = new Date(),
): Promise<BackupTickResult> {
  const now = nowInput;
  const nowIso = now.toISOString();
  const [lastSuccess, latestRun, incident, state] = await Promise.all([
    latestSuccessfulBackup(db),
    db
      .prepare('SELECT status, summary, recorded_at FROM backup_runs ORDER BY recorded_at DESC LIMIT 1')
      .first<{ status: 'success' | 'failure'; summary: string; recorded_at: string }>(),
    db
      .prepare(
        "SELECT id, opened_at, escalation_sent_at FROM operations_incidents WHERE incident_key = 'backup_stale' AND status <> 'resolved' ORDER BY opened_at DESC LIMIT 1",
      )
      .first<{ id: string; opened_at: string; escalation_sent_at: string | null }>(),
    readCommunicationSettings(db).catch(() => null),
  ]);
  const escalationMinutes = state?.settings.alerts.escalationMinutes ?? 30;
  const health = evaluateBackupHealth({
    lastSuccessAt: lastSuccess,
    lastRunStatus: latestRun?.status ?? null,
    now,
    escalationMinutes,
    incidentOpenedAt: incident?.opened_at ?? null,
    escalationSentAt: incident?.escalation_sent_at ?? null,
  });

  if (health.status === 'healthy') {
    if (!incident) return { status: health.status, action: 'none' };
    await db
      .prepare("UPDATE operations_incidents SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso, nowIso, incident.id)
      .run();
    const lastRun = await db
      .prepare("SELECT recorded_at FROM backup_runs WHERE status = 'success' ORDER BY recorded_at DESC LIMIT 1")
      .first<{ recorded_at: string }>();
    const results = await Promise.all([
      sendAlert(db, env, 'admin', 'RECOVERED: Sparkling Standard backup resumed', alertText(escalationMinutes, `A successful backup run was recorded at ${lastRun?.recorded_at ?? nowIso}.`, nowIso), incident.id),
      sendAlert(db, env, 'owner', 'RECOVERED: Sparkling Standard backup resumed', alertText(escalationMinutes, `A successful backup run was recorded at ${lastRun?.recorded_at ?? nowIso}.`, nowIso), incident.id),
    ]);
    return {
      status: health.status,
      action: results.some((result) => result.sent) ? 'resolved_recovery' : 'resolved_without_notice',
      incidentId: incident.id,
    };
  }

  const detail =
    health.status === 'failed'
      ? `The most recent backup run failed at ${latestRun?.recorded_at ?? nowIso}. ${latestRun?.summary ?? 'No failure detail was supplied.'}`
      : health.status === 'missing'
        ? 'No successful backup run has been recorded. The backup workflow may be dormant, misconfigured or failing before it reports.'
        : `The last successful backup was recorded ${health.ageHours?.toFixed(1) ?? 'unknown'} hours ago, beyond the approved daily window.`;

  if (!incident) {
    const id = `incident_${crypto.randomUUID()}`;
    // incident_key is unique. A previously resolved backup incident must be
    // reopened for a new failure instead of blocking the insert, otherwise the
    // alert path would fail silently after the first recovery in production.
    await db
      .prepare(
        `INSERT INTO operations_incidents
         (id, incident_key, kind, severity, status, summary, detail, opened_at, last_notified_at, updated_at)
         VALUES (?, 'backup_stale', 'backup', 'critical', 'open', ?, ?, ?, ?, ?)
         ON CONFLICT(incident_key) DO UPDATE SET
           kind = excluded.kind,
           severity = excluded.severity,
           status = 'open',
           summary = excluded.summary,
           detail = excluded.detail,
           opened_at = excluded.opened_at,
           last_notified_at = excluded.last_notified_at,
           escalation_sent_at = NULL,
           resolved_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        'Backup failure or missed backup',
        detail,
        nowIso,
        nowIso,
        nowIso,
      )
      .run();
    // The upsert keeps the existing row id when reopening a resolved incident,
    // so resolve the durable id before linking delivery events and audit rows.
    const stored = await db
      .prepare("SELECT id FROM operations_incidents WHERE incident_key = 'backup_stale' LIMIT 1")
      .first<{ id: string }>();
    const incidentId = stored?.id ?? id;
    const text = alertText(escalationMinutes, detail, nowIso);
    const subject = 'CRITICAL: Sparkling Standard backup failure';
    const results = await Promise.all([
      sendAlert(db, env, 'admin', subject, text, incidentId),
      sendAlert(db, env, 'owner', subject, text, incidentId),
    ]);
    await audit(db, {
      actorUserId: null,
      action: 'backup.incident_opened',
      entityType: 'operations_incident',
      entityId: incidentId,
      detail: health.status,
    }).catch(() => undefined);
    return {
      status: health.status,
      action: results.some((result) => result.sent) ? 'alerted_admin_and_owner' : 'none',
      incidentId,
    };
  }

  if (health.shouldEscalate) {
    const text = alertText(escalationMinutes, `${detail}\n\nThis incident remains unresolved.`, nowIso);
    const result = await sendAlert(
      db,
      env,
      'owner',
      'ESCALATION: Sparkling Standard backup remains unresolved',
      text,
      incident.id,
    );
    await db
      .prepare(
        "UPDATE operations_incidents SET escalation_sent_at = ?, last_notified_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(nowIso, nowIso, nowIso, incident.id)
      .run();
    await audit(db, {
      actorUserId: null,
      action: 'backup.escalated_to_owner',
      entityType: 'operations_incident',
      entityId: incident.id,
      detail: result.sent ? 'provider_accepted' : 'delivery_not_confirmed',
    }).catch(() => undefined);
    return { status: health.status, action: result.sent ? 'escalated_owner' : 'none', incidentId: incident.id };
  }

  return { status: health.status, action: 'none', incidentId: incident.id };
}

/**
 * Render the approved backup alert template for callers that need the exact
 * owner-facing message without sending it.
 */
export async function previewBackupAlert(
  db: D1Database,
  detail: string,
  occurredAt: string,
): Promise<{ subject: string; body: string }> {
  const state = await readCommunicationSettings(db).catch(() => null);
  const settings = state?.settings;
  const minutes = settings?.alerts.escalationMinutes ?? 30;
  if (!settings) {
    return {
      subject: 'CRITICAL: Sparkling Standard backup failure',
      body: alertText(minutes, detail, occurredAt),
    };
  }
  return renderTemplate('backup_alert', settings.templates.backup_alert, {
    event_detail: detail,
    occurred_at: occurredAt,
    escalation_minutes: String(minutes),
  });
}
