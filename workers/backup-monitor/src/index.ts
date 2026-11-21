/**
 * Scheduled backup monitor.
 *
 * Every 15 minutes this Worker evaluates the latest backup heartbeat, opens an
 * incident for a failed or missing backup, alerts admin@ and owner@, and
 * escalates an unresolved incident to the owner after the configured interval.
 *
 * It sends notifications only. It never downloads, decrypts or restores backup
 * contents, so a running Worker is not evidence that a backup is restorable.
 */

import type { D1Database } from '../../../src/lib/admin/d1.ts';
import { backupMonitorTick, type BackupMonitorEnv } from '../../../src/lib/admin/backup-monitor.ts';

interface Env extends BackupMonitorEnv {
  DB?: D1Database;
  BACKUP_MONITOR_TOKEN?: string;
}

interface ScheduledEvent {
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function run(env: Env): Promise<Record<string, unknown>> {
  if (!env.DB) return { ok: false, error: 'database_not_configured' };
  const result = await backupMonitorTick(env.DB, env);
  return { ok: true, ...result };
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await run(env);
    console.log(JSON.stringify({ event: 'backup_monitor_tick', ...result }));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const expected = env.BACKUP_MONITOR_TOKEN?.trim();
    if (!expected) return json({ ok: false, error: 'monitor_not_configured' }, 503);
    const authorization = request.headers.get('Authorization') ?? '';
    if (authorization !== `Bearer ${expected}`) return json({ ok: false, error: 'unauthorized' }, 401);
    return json(await run(env));
  },
};
