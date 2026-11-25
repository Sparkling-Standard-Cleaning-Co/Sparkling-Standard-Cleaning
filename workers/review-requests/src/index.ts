/**
 * Scheduled review-invitation delivery.
 *
 * Sends only due, recent, queued invitations whose branch automation switch is
 * still enabled. It never sends a historical backlog and never sends when the
 * owner disables automation.
 */

import type { D1Database } from '../../../src/lib/admin/d1.ts';
import { processDueReviewRequests, type ReviewDeliveryEnv } from '../../../src/lib/reviews/delivery.ts';

interface Env extends ReviewDeliveryEnv {
  DB?: D1Database;
  REVIEW_MONITOR_TOKEN?: string;
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
  const result = await processDueReviewRequests(env.DB, env);
  return { ok: true, ...result };
}

export default {
  async scheduled(_event: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await run(env);
    console.log(JSON.stringify({ event: 'review_request_run', ...result }));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const expected = env.REVIEW_MONITOR_TOKEN?.trim();
    if (!expected) return json({ ok: false, error: 'review_monitor_not_configured' }, 503);
    if ((request.headers.get('Authorization') ?? '') !== `Bearer ${expected}`) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    return json(await run(env));
  },
};
