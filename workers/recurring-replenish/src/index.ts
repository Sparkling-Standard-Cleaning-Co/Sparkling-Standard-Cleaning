/**
 * Daily recurring replenishment Worker.
 *
 * Reuses the production recurring engine, D1 database and the existing Google
 * Calendar credentials. It never creates a second calendar or identity system.
 * Deployment requires the existing D1 database id and the same Google/MapMap
 * secrets already used by the Pages project.
 */
import { syncRecurringPlan, type RecurringEnv } from '../../../src/lib/admin/recurring-schedule.ts';
import type { AdminActor } from '../../../src/lib/admin/operations.ts';

interface Env extends RecurringEnv {
  RECURRING_SCHEDULING_ENABLED?: string;
}

interface ScheduledController {
  scheduledTime?: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const SYSTEM_ACTOR: AdminActor = {
  id: 'system',
  email: 'system@sparkling-standard.local',
  name: 'Recurring replenishment Worker',
  role: 'owner',
  branchId: null,
  csrf: '',
  permissions: [],
  mfaEnabled: false,
};

function centralDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function claimRun(env: Env, runKey: string): Promise<boolean> {
  const db = env.DB;
  if (!db) return false;
  const id = `run_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO recurring_worker_runs (id, run_key, status, started_at)
       VALUES (?, ?, 'running', ?)`,
    )
    .bind(id, runKey, startedAt)
    .run();
  const row = await db
    .prepare('SELECT id, status, started_at FROM recurring_worker_runs WHERE run_key = ? LIMIT 1')
    .bind(runKey)
    .first<{ id: string; status: string; started_at: string }>();
  if (!row) return false;
  if (row.status === 'completed') return false;
  const stale = Date.now() - Date.parse(row.started_at) > 30 * 60_000;
  if (row.status === 'running' && !stale) return false;
  await db
    .prepare("UPDATE recurring_worker_runs SET status = 'running', started_at = ?, finished_at = NULL WHERE id = ?")
    .bind(startedAt, row.id)
    .run();
  return true;
}

async function finishRun(
  env: Env,
  runKey: string,
  status: 'completed' | 'failed',
  summary: { scanned: number; synced: number; errors: number; detail: unknown },
): Promise<void> {
  if (!env.DB) return;
  await env.DB
    .prepare(
      `UPDATE recurring_worker_runs
       SET status = ?, finished_at = ?, plans_scanned = ?, plans_synced = ?, errors = ?, detail_json = ?
       WHERE run_key = ?`,
    )
    .bind(
      status,
      new Date().toISOString(),
      summary.scanned,
      summary.synced,
      summary.errors,
      JSON.stringify(summary.detail).slice(0, 20_000),
      runKey,
    )
    .run();
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.RECURRING_SCHEDULING_ENABLED !== 'true') {
      console.log('[recurring-replenish] disabled');
      return;
    }
    if (!env.DB) {
      console.error('[recurring-replenish] database_not_configured');
      return;
    }
    const runKey = centralDateKey(controller.scheduledTime ? new Date(controller.scheduledTime) : new Date());
    if (!(await claimRun(env, runKey))) {
      console.log('[recurring-replenish] already_claimed_or_completed', runKey);
      return;
    }
    const summary = { scanned: 0, synced: 0, errors: 0, detail: [] as Array<Record<string, unknown>> };
    try {
      const plans = await env.DB
        .prepare(
          `SELECT id FROM recurring_plans
           WHERE status = 'active' AND window IS NOT NULL AND start_time IS NOT NULL
             AND duration_minutes IS NOT NULL
           ORDER BY next_visit_date ASC LIMIT 50`,
        )
        .all<{ id: string }>();
      for (const plan of plans.results ?? []) {
        summary.scanned += 1;
        try {
          const result = await syncRecurringPlan(env, env.DB, SYSTEM_ACTOR, plan.id, {
            cancelSuperseded: false,
          });
          if (result.ok) summary.synced += 1;
          else summary.errors += 1;
          summary.detail.push({
            planId: plan.id,
            status: result.status,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            conflicts: result.conflicts.length,
            errors: result.errors,
          });
        } catch (error) {
          summary.errors += 1;
          summary.detail.push({ planId: plan.id, status: 'exception', error: (error as Error).message });
        }
      }
      await finishRun(env, runKey, summary.errors > 0 ? 'failed' : 'completed', summary);
      console.log('[recurring-replenish] complete', JSON.stringify({ scanned: summary.scanned, synced: summary.synced, errors: summary.errors }));
    } catch (error) {
      await finishRun(env, runKey, 'failed', {
        ...summary,
        detail: [...summary.detail, { error: (error as Error).message }],
      }).catch(() => undefined);
      console.error('[recurring-replenish] run_failed', { name: (error as Error).name });
      ctx.waitUntil(Promise.resolve());
    }
  },
};
