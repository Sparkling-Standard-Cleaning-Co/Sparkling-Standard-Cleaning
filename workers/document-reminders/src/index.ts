/**
 * Scheduled document signing reminders.
 *
 * Runs hourly and sends the 24h and 72h reminders (owner-configurable) for
 * pending signing requests. Never cancels an appointment or agreement.
 */

import type { D1Database } from '../../../src/lib/admin/d1.ts';
import { processSigningReminders, type ReminderEnv } from '../../../src/lib/documents/reminders.ts';

interface Env extends ReminderEnv {
  DB?: D1Database;
  REMINDER_MONITOR_TOKEN?: string;
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
  const result = await processSigningReminders(env.DB, env);
  return { ok: true, ...result };
}

export default {
  async scheduled(_event: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await run(env);
    console.log(JSON.stringify({ event: 'document_reminder_run', ...result }));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const expected = env.REMINDER_MONITOR_TOKEN?.trim();
    if (!expected) return json({ ok: false, error: 'reminder_monitor_not_configured' }, 503);
    if ((request.headers.get('Authorization') ?? '') !== `Bearer ${expected}`) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    return json(await run(env));
  },
};
