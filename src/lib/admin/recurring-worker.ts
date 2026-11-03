/**
 * Shared recurring replenishment run used by the protected Pages endpoint and
 * the daily Cloudflare Worker trigger. The engine runs inside the existing
 * Pages environment so it reuses the existing D1, Google Calendar and MapMap
 * credentials without copying secrets into a second runtime.
 */
import type { D1Database } from './d1.ts';
import type { AdminActor } from './operations.ts';
import { syncRecurringPlan, type RecurringEnv } from './recurring-schedule.ts';

const SYSTEM_ACTOR: AdminActor = {
  id: 'system',
  email: 'system@sparkling-standard.local',
  name: 'Recurring replenishment',
  role: 'owner',
  branchId: null,
  csrf: '',
  permissions: [],
  mfaEnabled: false,
};

export interface ReplenishSummary {
  ok: boolean;
  runKey: string;
  scanned: number;
  synced: number;
  errors: number;
  skippedReason?: string;
  detail: Array<Record<string, unknown>>;
}

export function centralDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function claimRun(db: D1Database, runKey: string): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const id = `run_${crypto.randomUUID()}`;
  const owner = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO recurring_worker_runs (id, run_key, status, started_at, owner_token)
       VALUES (?, ?, 'running', ?, ?)`,
    )
    .bind(id, runKey, startedAt, owner)
    .run();
  const row = await db
    .prepare(
      'SELECT id, status, started_at, owner_token FROM recurring_worker_runs WHERE run_key = ? LIMIT 1',
    )
    .bind(runKey)
    .first<{ id: string; status: string; started_at: string; owner_token: string }>();
  if (!row) return { ok: false, reason: 'run_claim_failed' };
  // Our own insert carries this request's owner token. Never treat it as a
  // concurrent run.
  if (row.owner_token === owner) return { ok: true, id: row.id };
  if (row.status === 'completed') return { ok: false, reason: 'already_completed' };
  const stale = Date.now() - Date.parse(row.started_at) > 30 * 60_000;
  if (row.status === 'running' && !stale) return { ok: false, reason: 'already_running' };
  await db
    .prepare(
      "UPDATE recurring_worker_runs SET status = 'running', started_at = ?, finished_at = NULL, owner_token = ? WHERE id = ?",
    )
    .bind(startedAt, owner, row.id)
    .run();
  return { ok: true, id: row.id };
}

async function finishRun(
  db: D1Database,
  runId: string,
  status: 'completed' | 'failed',
  summary: ReplenishSummary,
): Promise<void> {
  await db
    .prepare(
      `UPDATE recurring_worker_runs
       SET status = ?, finished_at = ?, plans_scanned = ?, plans_synced = ?, errors = ?, detail_json = ?,
           owner_token = ''
       WHERE id = ?`,
    )
    .bind(
      status,
      new Date().toISOString(),
      summary.scanned,
      summary.synced,
      summary.errors,
      JSON.stringify(summary.detail).slice(0, 20_000),
      runId,
    )
    .run();
}

export async function runRecurringReplenishment(
  env: RecurringEnv,
  db: D1Database,
  runKey = centralDateKey(new Date()),
): Promise<ReplenishSummary> {
  const claim = await claimRun(db, runKey);
  if (!claim.ok || !claim.id) {
    return {
      ok: true,
      runKey,
      scanned: 0,
      synced: 0,
      errors: 0,
      skippedReason: claim.reason ?? 'already_claimed',
      detail: [],
    };
  }
  const summary: ReplenishSummary = {
    ok: false,
    runKey,
    scanned: 0,
    synced: 0,
    errors: 0,
    detail: [],
  };
  try {
    const planIds: string[] = [];
    let cursor = '';
    for (let page = 0; page < 20; page += 1) {
      const batch = await db
        .prepare(
          `SELECT id FROM recurring_plans
           WHERE status = 'active' AND window IS NOT NULL AND start_time IS NOT NULL
             AND duration_minutes IS NOT NULL AND id > ?
           ORDER BY id ASC LIMIT 50`,
        )
        .bind(cursor)
        .all<{ id: string }>();
      const rows = batch.results ?? [];
      for (const row of rows) planIds.push(row.id);
      if (rows.length < 50) break;
      cursor = rows[rows.length - 1]!.id;
    }
    for (const planId of planIds) {
      summary.scanned += 1;
      try {
        const result = await syncRecurringPlan(env, db, SYSTEM_ACTOR, planId, {
          cancelSuperseded: false,
        });
        if (result.ok) summary.synced += 1;
        else summary.errors += 1;
        summary.detail.push({
          planId,
          status: result.status,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          conflicts: result.conflicts.length,
          conflictDetails: result.conflicts.slice(0, 10),
          errors: result.errors,
        });
      } catch (error) {
        summary.errors += 1;
        summary.detail.push({ planId, status: 'exception', error: (error as Error).message });
      }
    }
    summary.ok = summary.errors === 0;
    await finishRun(db, claim.id, summary.ok ? 'completed' : 'failed', summary);
    return summary;
  } catch (error) {
    summary.errors += 1;
    summary.detail.push({ error: (error as Error).message });
    await finishRun(db, claim.id, 'failed', summary).catch(() => undefined);
    return summary;
  }
}
