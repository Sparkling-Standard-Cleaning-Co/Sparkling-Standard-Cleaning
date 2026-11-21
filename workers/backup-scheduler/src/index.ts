/**
 * Daily GitHub Actions dispatcher for the production-safe backup workflow.
 *
 * GitHub only evaluates `schedule` triggers from the repository default branch.
 * The default branch is `main`, while production and the backup workflow live
 * on `production-safe`. This Worker triggers `workflow_dispatch` explicitly on
 * the production-safe ref without changing either branch or the Cloudflare
 * Pages deployment source.
 *
 * Required Worker secrets:
 *   GITHUB_DISPATCH_TOKEN - fine-grained token with Actions:write on the repo
 *   BACKUP_SCHEDULER_TOKEN - random token for the manual health check
 */

interface Env {
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_REF?: string;
  GITHUB_WORKFLOW?: string;
  BACKUP_SCHEDULER_TOKEN?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledEvent {
  scheduledTime: number;
}

const DEFAULT_REPO = 'Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning';
const DEFAULT_REF = 'production-safe';
const DEFAULT_WORKFLOW = 'backup.yml';

export function dispatchRequest(env: Env): { url: string; init: RequestInit } | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) return null;
  const repo = (env.GITHUB_REPO?.trim() || DEFAULT_REPO).replace(/^\/+|\/+$/g, '');
  const ref = env.GITHUB_REF?.trim() || DEFAULT_REF;
  const workflow = env.GITHUB_WORKFLOW?.trim() || DEFAULT_WORKFLOW;
  return {
    url: `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'sparkling-standard-backup-scheduler',
      },
      body: JSON.stringify({ ref, return_run_details: true }),
    },
  };
}

async function dispatch(env: Env): Promise<Record<string, unknown>> {
  const request = dispatchRequest(env);
  if (!request) return { ok: false, error: 'scheduler_not_configured' };
  const response = await fetch(request.url, request.init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: body?.message ?? 'github_dispatch_failed',
    };
  }
  return {
    ok: true,
    status: response.status,
    workflowRun: body?.workflow_run_id ?? null,
    runUrl: body?.html_url ?? null,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(env).then((result) => console.log(JSON.stringify({ event: 'backup_dispatch', ...result }))));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const expected = env.BACKUP_SCHEDULER_TOKEN?.trim();
    if (!expected) return json({ ok: false, error: 'scheduler_not_configured' }, 503);
    const authorization = request.headers.get('Authorization') ?? '';
    if (authorization !== `Bearer ${expected}`) return json({ ok: false, error: 'unauthorized' }, 401);
    return json(await dispatch(env));
  },
};
