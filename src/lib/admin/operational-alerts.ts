import type { D1Database } from './d1.ts';
import { AdminAuthError, audit, type AdminActor } from './operations.ts';

export type OperationalAlertAction =
  | 'acknowledge'
  | 'investigate'
  | 'resolve'
  | 'dismiss'
  | 'reopen';

export interface OperationalAlertState {
  alert_key: string;
  status: 'new' | 'investigating' | 'acknowledged' | 'resolved' | 'dismissed';
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string;
  dismissed_at: string | null;
  updated_at: string;
}

const STATUS_BY_ACTION: Record<OperationalAlertAction, OperationalAlertState['status']> = {
  acknowledge: 'acknowledged',
  investigate: 'investigating',
  resolve: 'resolved',
  dismiss: 'dismissed',
  reopen: 'new',
};

export async function readAlertStates(
  db: D1Database,
  keys: string[],
): Promise<Map<string, OperationalAlertState>> {
  if (keys.length === 0) return new Map();
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT alert_key, status, acknowledged_at, resolved_at, resolution_note, dismissed_at, updated_at
       FROM operational_alerts WHERE alert_key IN (${placeholders})`,
    )
    .bind(...keys)
    .all<OperationalAlertState>()
    .catch(() => ({ results: [] as OperationalAlertState[] }));
  return new Map((rows.results ?? []).map((row) => [row.alert_key, row]));
}

export async function applyAlertAction(
  db: D1Database,
  actor: AdminActor,
  input: { alertKey: string; action: OperationalAlertAction; note?: string; title?: string; kind?: string },
): Promise<OperationalAlertState> {
  const alertKey = input.alertKey.trim().slice(0, 160);
  if (!alertKey) throw new AdminAuthError(400, 'alert_key_required');
  if (input.action === 'dismiss' && actor.role !== 'owner') {
    throw new AdminAuthError(403, 'owner_required');
  }
  const status = STATUS_BY_ACTION[input.action];
  if (!status) throw new AdminAuthError(400, 'alert_action_invalid');
  const now = new Date().toISOString();
  const note = String(input.note ?? '').trim().slice(0, 1000);
  if (input.action === 'resolve' && !note) {
    throw new AdminAuthError(400, 'resolution_note_required');
  }
  await db
    .prepare(
      `INSERT INTO operational_alerts
       (id, alert_key, kind, status, title, first_seen_at, last_seen_at, updated_at,
        acknowledged_at, acknowledged_by_admin_user_id, resolved_at, resolved_by_admin_user_id,
        resolution_note, dismissed_at, dismissed_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(alert_key) DO UPDATE SET
         status = excluded.status,
         title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE operational_alerts.title END,
         kind = CASE WHEN excluded.kind <> '' THEN excluded.kind ELSE operational_alerts.kind END,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at,
         acknowledged_at = CASE WHEN excluded.status IN ('acknowledged','investigating')
           THEN excluded.acknowledged_at ELSE operational_alerts.acknowledged_at END,
         acknowledged_by_admin_user_id = CASE WHEN excluded.status IN ('acknowledged','investigating')
           THEN excluded.acknowledged_by_admin_user_id ELSE operational_alerts.acknowledged_by_admin_user_id END,
         resolved_at = CASE WHEN excluded.status = 'resolved' THEN excluded.resolved_at ELSE NULL END,
         resolved_by_admin_user_id = CASE WHEN excluded.status = 'resolved'
           THEN excluded.resolved_by_admin_user_id ELSE NULL END,
         resolution_note = CASE WHEN excluded.status = 'resolved' THEN excluded.resolution_note ELSE '' END,
         dismissed_at = CASE WHEN excluded.status = 'dismissed' THEN excluded.dismissed_at ELSE NULL END,
         dismissed_by_admin_user_id = CASE WHEN excluded.status = 'dismissed'
           THEN excluded.dismissed_by_admin_user_id ELSE NULL END`,
    )
    .bind(
      `alert_${crypto.randomUUID()}`,
      alertKey,
      String(input.kind ?? '').slice(0, 80),
      status,
      String(input.title ?? '').slice(0, 240),
      now,
      now,
      now,
      status === 'acknowledged' || status === 'investigating' ? now : null,
      status === 'acknowledged' || status === 'investigating' ? actor.id : null,
      status === 'resolved' ? now : null,
      status === 'resolved' ? actor.id : null,
      status === 'resolved' ? note : '',
      status === 'dismissed' ? now : null,
      status === 'dismissed' ? actor.id : null,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: `operations.alert_${input.action}`,
    entityType: 'operational_alert',
    entityId: alertKey,
    detail: note,
  });
  const states = await readAlertStates(db, [alertKey]);
  return (
    states.get(alertKey) ?? {
      alert_key: alertKey,
      status,
      acknowledged_at: null,
      resolved_at: null,
      resolution_note: note,
      dismissed_at: null,
      updated_at: now,
    }
  );
}
