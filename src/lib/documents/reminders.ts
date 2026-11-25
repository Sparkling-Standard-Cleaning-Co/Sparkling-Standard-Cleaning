// Document signing reminders (24h and 72h by default).
//
// Reminders never cancel an appointment or agreement. They send the approved
// signing path, record each attempt, and stop once the request is signed,
// declined, void or expired. If the stored signing link has expired, a fresh
// 7-day link is issued; otherwise the customer is pointed to the existing link.

import type { D1Database } from '../admin/d1.ts';
import { audit } from '../admin/operations.ts';
import { buildSigningReminderEmail, sendAdminEmail, type AdminEmailEnv } from '../admin/email.ts';
import { rotateSigningRequestToken } from './service.ts';

export interface ReminderEnv extends AdminEmailEnv {}

export interface ReminderSettings {
  enabled: boolean;
  firstHours: number;
  secondHours: number;
}

const SETTINGS_KEY = 'documents.reminders';
const DEFAULT_SETTINGS: ReminderSettings = { enabled: true, firstHours: 24, secondHours: 72 };

function boundedHours(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(168, Math.max(1, Math.round(parsed))) : fallback;
}

export async function readReminderSettings(db: D1Database): Promise<ReminderSettings> {
  const row = await db
    .prepare('SELECT value_json FROM admin_settings WHERE key = ? LIMIT 1')
    .bind(SETTINGS_KEY)
    .first<{ value_json: string }>();
  if (!row?.value_json) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.value_json) as Record<string, unknown>;
    const firstHours = boundedHours(parsed.firstHours, DEFAULT_SETTINGS.firstHours);
    const secondHours = boundedHours(parsed.secondHours, DEFAULT_SETTINGS.secondHours);
    return {
      enabled: parsed.enabled !== false,
      firstHours,
      secondHours: Math.max(secondHours, firstHours + 1),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveReminderSettings(
  db: D1Database,
  actorUserId: string,
  input: Record<string, unknown>,
): Promise<ReminderSettings> {
  const firstHours = boundedHours(input.firstHours, DEFAULT_SETTINGS.firstHours);
  const secondHours = Math.max(boundedHours(input.secondHours, DEFAULT_SETTINGS.secondHours), firstHours + 1);
  const settings: ReminderSettings = { enabled: input.enabled !== false, firstHours, secondHours };
  await db
    .prepare(
      `INSERT INTO admin_settings (key, value_json, updated_by_admin_user_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
         updated_by_admin_user_id = excluded.updated_by_admin_user_id, updated_at = excluded.updated_at`,
    )
    .bind(SETTINGS_KEY, JSON.stringify(settings), actorUserId, new Date().toISOString())
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.reminder_settings_saved',
    entityType: 'document_reminder_settings',
    entityId: SETTINGS_KEY,
    detail: `${firstHours}:${secondHours}:${settings.enabled}`,
  }).catch(() => undefined);
  return settings;
}

interface PendingRequest {
  id: string;
  status: string;
  created_at: string;
  token_expires_at: string;
  bundle_code: string;
  packet_name: string;
  signer_email: string;
  customer_id: string | null;
  team_member_id: string | null;
}

export interface ReminderRunResult {
  enabled: boolean;
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  details: Array<{ requestId: string; reminder: '24h' | '72h'; status: string }>;
}

function emailValid(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function processSigningReminders(
  db: D1Database,
  env: ReminderEnv,
  nowInput: Date = new Date(),
): Promise<ReminderRunResult> {
  const settings = await readReminderSettings(db);
  if (!settings.enabled) {
    return { enabled: false, scanned: 0, sent: 0, failed: 0, skipped: 0, details: [] };
  }
  const nowIso = nowInput.toISOString();
  const cutoff = new Date(nowInput.getTime() - settings.firstHours * 3_600_000).toISOString();
  const rows = await db
    .prepare(
      `SELECT sr.id, sr.status, sr.created_at, sr.token_expires_at, sr.bundle_code, sr.packet_name,
              sr.signer_email, sr.customer_id, sr.team_member_id,
              COALESCE(
                (SELECT value FROM customer_contacts cc WHERE cc.customer_id = sr.customer_id AND cc.kind = 'email' LIMIT 1),
                (SELECT email FROM team_members tm WHERE tm.id = sr.team_member_id),
                ''
              ) AS contact_email
       FROM signing_requests sr
       WHERE sr.status IN ('pending','partially_signed')
         AND sr.created_at <= ?
       ORDER BY sr.created_at ASC LIMIT 200`,
    )
    .bind(cutoff)
    .all<Record<string, unknown>>();
  const requests: PendingRequest[] = (rows.results ?? []).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    created_at: String(row.created_at),
    token_expires_at: String(row.token_expires_at ?? ''),
    bundle_code: String(row.bundle_code ?? ''),
    packet_name: String(row.packet_name ?? ''),
    signer_email: String(row.contact_email || row.signer_email || ''),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    team_member_id: row.team_member_id ? String(row.team_member_id) : null,
  }));
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const details: ReminderRunResult['details'] = [];
  for (const request of requests) {
    if (!emailValid(request.signer_email)) {
      skipped += 1;
      continue;
    }
    const ageHours = (nowInput.getTime() - new Date(request.created_at).getTime()) / 3_600_000;
    const candidates = ([
      ['24h', settings.firstHours],
      ['72h', settings.secondHours],
    ] as const).filter(([, hours]) => ageHours >= hours);
    let reminderKey: '24h' | '72h' | null = null;
    for (const [key] of candidates) {
      const exists = await db
        .prepare('SELECT id FROM document_signing_reminders WHERE signing_request_id = ? AND reminder_key = ? LIMIT 1')
        .bind(request.id, key)
        .first<{ id: string }>();
      if (!exists) {
        reminderKey = key;
        break;
      }
    }
    if (!reminderKey) {
      skipped += 1;
      continue;
    }
    const reminderId = `drem_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO document_signing_reminders (id, signing_request_id, reminder_key, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)
         ON CONFLICT(signing_request_id, reminder_key) DO NOTHING`,
      )
      .bind(reminderId, request.id, reminderKey, nowIso)
      .run();
    const tokenExpires = new Date(request.token_expires_at).getTime();
    const needsFreshLink = !Number.isFinite(tokenExpires) || tokenExpires <= nowInput.getTime() + 3_600_000;
    let token: string | undefined;
    if (needsFreshLink && env.RESEND_API_KEY?.trim()) {
      try {
        const rotated = await rotateSigningRequestToken(db, null, request.id);
        token = rotated.token;
      } catch {
        token = undefined;
      }
    }
    const bundleName = request.packet_name || request.bundle_code || 'Sparkling Standard documents';
    const email = buildSigningReminderEmail(env, bundleName, token);
    const delivered = await sendAdminEmail(
      env,
      request.signer_email,
      email,
      `document-reminder-${request.id}-${reminderKey}`,
    );
    const status = delivered ? 'sent' : 'failed';
    await db
      .prepare(
        'UPDATE document_signing_reminders SET status = ?, error_code = ?, sent_at = ? WHERE signing_request_id = ? AND reminder_key = ?',
      )
      .bind(
        status,
        delivered ? '' : env.RESEND_API_KEY ? 'provider_rejected' : 'resend_not_configured',
        delivered ? nowIso : null,
        request.id,
        reminderKey,
      )
      .run()
      .catch(() => undefined);
    await audit(db, {
      actorUserId: null,
      action: delivered ? 'documents.reminder_sent' : 'documents.reminder_failed',
      entityType: 'signing_request',
      entityId: request.id,
      detail: reminderKey,
    }).catch(() => undefined);
    if (delivered) sent += 1; else failed += 1;
    details.push({ requestId: request.id, reminder: reminderKey, status });
  }
  return { enabled: true, scanned: requests.length, sent, failed, skipped, details };
}
