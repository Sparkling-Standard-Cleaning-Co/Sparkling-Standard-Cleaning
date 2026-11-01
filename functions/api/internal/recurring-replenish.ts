// Protected internal endpoint for the daily recurring replenishment Worker.
// The Worker holds only a single-purpose bearer token; the recurring engine
// runs here with the existing Pages D1, Google Calendar and MapMap bindings.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { constantTimeEqual } from '../../../src/lib/admin/auth.ts';
import { runRecurringReplenishment } from '../../../src/lib/admin/recurring-worker.ts';
import type { RecurringEnv } from '../../../src/lib/admin/recurring-schedule.ts';

interface Env extends AdminDbEnv, RecurringEnv {
  RECURRING_WORKER_TOKEN?: string;
  RECURRING_WORKER_ENABLED?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  const expected = context.env.RECURRING_WORKER_TOKEN?.trim() ?? '';
  if (!expected) return json({ ok: false, error: 'worker_token_not_configured' }, 503);
  const authorization = context.request.headers.get('Authorization') ?? '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!provided || !constantTimeEqual(provided, expected)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (context.env.RECURRING_WORKER_ENABLED !== 'true') {
    return json({ ok: true, disabled: true, reason: 'recurring_scheduling_gated' });
  }
  try {
    const requestedRunKey = context.request.headers.get('X-Recurring-Run-Key') ?? '';
    const runKey = /^\d{4}-\d{2}-\d{2}$/.test(requestedRunKey) ? requestedRunKey : undefined;
    const summary = await runRecurringReplenishment(context.env, db, runKey);
    return json({ ...summary, ok: summary.ok });
  } catch (error) {
    return json({ ok: false, error: 'replenish_failed', detail: (error as Error).message }, 500);
  }
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}

