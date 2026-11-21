// Internal backup-status intake for the scheduled backup workflow.
//
// Authentication is a dedicated bearer token held only in GitHub repository
// secrets and Cloudflare. The endpoint records the run heartbeat, opens an
// incident on failure and notifies admin@ and owner@ immediately. It never
// exposes backup contents, credentials or customer data.

import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import {
  backupMonitorTick,
  recordBackupRun,
  type BackupMonitorEnv,
} from '../../../src/lib/admin/backup-monitor.ts';

interface Env extends AdminDbEnv, BackupMonitorEnv {
  OPS_ALERT_TOKEN?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const expected = context.env.OPS_ALERT_TOKEN?.trim();
  if (!expected) return json({ ok: false, error: 'backup_status_not_configured' }, 503);
  const authorization = context.request.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || !constantTimeEqual(token, expected)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
  const runKey = String(body.runKey ?? '').trim();
  const status = String(body.status ?? '');
  if (!/^[A-Za-z0-9_.:-]{3,160}$/.test(runKey)) return json({ ok: false, error: 'run_key_invalid' }, 400);
  if (status !== 'success' && status !== 'failure') return json({ ok: false, error: 'status_invalid' }, 400);
  const detail = body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)
    ? body.detail as Record<string, unknown>
    : {};
  await recordBackupRun(db, {
    runKey,
    status,
    summary: String(body.summary ?? '').slice(0, 1000),
    detail,
    ...(body.startedAt ? { startedAt: String(body.startedAt).slice(0, 40) } : {}),
    ...(body.finishedAt ? { finishedAt: String(body.finishedAt).slice(0, 40) } : {}),
  });
  const tick = await backupMonitorTick(db, context.env).catch(() => null);
  return json({ ok: true, recorded: true, monitor: tick });
}
