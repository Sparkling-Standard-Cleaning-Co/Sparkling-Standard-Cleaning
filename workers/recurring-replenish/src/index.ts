/**
 * Daily recurring replenishment trigger.
 *
 * The actual recurring engine runs in the existing Pages environment through a
 * token-protected internal endpoint, so the Worker reuses the existing D1,
 * Google Calendar and MapMap credentials without copying secrets into a second
 * runtime. The Worker holds only a single-purpose bearer token.
 */
interface Env {
  RECURRING_WORKER_ENABLED?: string;
  RECURRING_REPLENISH_URL?: string;
  RECURRING_WORKER_TOKEN?: string;
}

interface ScheduledController {
  scheduledTime?: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function centralDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.RECURRING_WORKER_ENABLED !== 'true') {
      console.log('[recurring-replenish] disabled');
      return;
    }
    const url = env.RECURRING_REPLENISH_URL?.trim();
    const token = env.RECURRING_WORKER_TOKEN?.trim();
    if (!url || !token) {
      console.error('[recurring-replenish] endpoint_not_configured');
      return;
    }
    const runKey = centralDateKey(controller.scheduledTime ? new Date(controller.scheduledTime) : new Date());
    const work = (async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Recurring-Run-Key': runKey,
        },
        body: JSON.stringify({ runKey }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.text().catch(() => '');
      if (!response.ok) {
        console.error('[recurring-replenish] endpoint_failed', { status: response.status, body: body.slice(0, 500) });
        return;
      }
      console.log('[recurring-replenish] complete', body.slice(0, 1000));
    })();
    ctx.waitUntil(work);
    await work.catch((error) => {
      console.error('[recurring-replenish] request_failed', { name: (error as Error).name });
    });
  },
};
