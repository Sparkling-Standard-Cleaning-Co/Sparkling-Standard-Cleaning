/**
 * Sparkling Standard backup control plane.
 *
 * This Worker is the server-side bridge between the owner-only admin screen and
 * GitHub Actions. The owner never has to open GitHub, Cloudflare or OneDrive to
 * start, monitor or verify a routine backup. GitHub remains the execution
 * engine because it can run the existing Node encryption, D1 export and isolated
 * restore checks for longer than a Pages request.
 *
 * Required secrets:
 *   GITHUB_DISPATCH_TOKEN - GitHub token limited to this repository (Actions)
 *   BACKUP_CONTROL_TOKEN  - random shared secret used by Pages and callbacks
 *
 * Required bindings:
 *   DB             - production D1 (backup_control_jobs / backup_schedule)
 *   BACKUP_BUCKET  - private encrypted-backup R2 bucket
 */

interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface R2Object {
  key: string;
  size: number;
  uploaded?: Date;
}

interface R2Bucket {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  get(key: string): Promise<{ body: ReadableStream; size?: number } | null>;
}

interface Env {
  GITHUB_DISPATCH_TOKEN?: string;
  BACKUP_CONTROL_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_REF?: string;
  GITHUB_WORKFLOW?: string;
  GITHUB_VERIFY_WORKFLOW?: string;
  DB?: D1Database;
  BACKUP_BUCKET?: R2Bucket;
  DOCUMENTS_BUCKET?: R2Bucket;
  PHOTOS_BUCKET?: R2Bucket;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledEvent {
  scheduledTime: number;
}

type JobStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled';
type JobOperation = 'backup' | 'verify' | 'restore_test';
type BackupScope = 'complete' | 'database';

interface JobRow extends Record<string, unknown> {
  id: string;
  job_key: string;
  operation: JobOperation;
  status: JobStatus;
  source: 'admin' | 'schedule';
  scope: BackupScope;
  archive_key: string;
  github_run_id: string;
  github_run_url: string;
  requested_by_admin_user_id: string | null;
  summary: string;
  detail_json: string;
  error: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

interface ScheduleRow extends Record<string, unknown> {
  enabled: number;
  cadence: 'daily' | 'weekly' | 'monthly';
  utc_hour: number;
  utc_minute: number;
  day_of_week: number;
  day_of_month: number;
  scope: BackupScope;
  retention_daily: number;
  retention_weekly: number;
  retention_monthly: number;
  updated_at: string;
}

const DEFAULT_REPO = 'Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning';
const DEFAULT_REF = 'production-safe';
const DEFAULT_WORKFLOW = 'backup.yml';
const DEFAULT_VERIFY_WORKFLOW = 'backup-verify.yml';
const BACKUP_PREFIX = 'sparkling-standard/backups';
const DOWNLOAD_TTL_SECONDS = 300;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Pure dispatch request used by tests and compatible with the old scheduler. */
export function dispatchRequest(env: Env): { url: string; init: RequestInit } | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) return null;
  const repoName = (env.GITHUB_REPO?.trim() || DEFAULT_REPO).replace(/^\/+|\/+$/g, '');
  const ref = env.GITHUB_REF?.trim() || DEFAULT_REF;
  const workflow = env.GITHUB_WORKFLOW?.trim() || DEFAULT_WORKFLOW;
  return {
    url: `https://api.github.com/repos/${repoName}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'sparkling-standard-backup-control',
      },
      body: JSON.stringify({ ref, return_run_details: true }),
    },
  };
}

function bearer(request: Request): string {
  const value = request.headers.get('Authorization') ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function authorised(request: Request, env: Env): boolean {
  const expected = env.BACKUP_CONTROL_TOKEN?.trim();
  return Boolean(expected && bearer(request) === expected);
}

function nowIso(): string {
  return new Date().toISOString();
}

function repo(env: Env): string {
  return (env.GITHUB_REPO?.trim() || DEFAULT_REPO).replace(/^\/+|\/+$/g, '');
}

function githubHeaders(env: Env): Record<string, string> {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) throw new Error('github_dispatch_not_configured');
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sparkling-standard-backup-control',
  };
}

async function githubJson(env: Env, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com/repos/${repo(env)}${path}`, {
    ...init,
    headers: { ...githubHeaders(env), ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body.message ?? `github_http_${response.status}`));
  }
  return body;
}

function backupJob(row: JobRow): Record<string, unknown> {
  let detail: unknown = {};
  try {
    detail = JSON.parse(row.detail_json || '{}');
  } catch {
    detail = {};
  }
  return {
    id: row.id,
    operation: row.operation,
    status: row.status,
    source: row.source,
    scope: row.scope,
    archiveKey: row.archive_key,
    githubRunUrl: row.github_run_url,
    summary: row.summary,
    detail,
    error: row.error,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function readJob(env: Env, id: string): Promise<JobRow | null> {
  if (!env.DB || !id) return null;
  return env.DB.prepare('SELECT * FROM backup_control_jobs WHERE id = ? LIMIT 1').bind(id).first<JobRow>();
}

async function activeJob(env: Env): Promise<JobRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare(
    "SELECT * FROM backup_control_jobs WHERE status IN ('queued','running') ORDER BY requested_at DESC LIMIT 1",
  ).first<JobRow>();
}

async function dispatch(env: Env, job: JobRow, extra: Record<string, string> = {}): Promise<{ runId: string; runUrl: string }> {
  const workflow = job.operation === 'backup'
    ? (env.GITHUB_WORKFLOW?.trim() || DEFAULT_WORKFLOW)
    : (env.GITHUB_VERIFY_WORKFLOW?.trim() || DEFAULT_VERIFY_WORKFLOW);
  const ref = env.GITHUB_REF?.trim() || DEFAULT_REF;
  const inputs: Record<string, string> = {
    job_id: job.id,
    scope: job.scope,
    ...extra,
  };
  const body = await githubJson(env, `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs, return_run_details: true }),
  });
  let runId = String(body.workflow_run_id ?? body.run_id ?? '');
  let runUrl = String(body.html_url ?? body.workflow_run_url ?? '');
  if (!runId) {
    const runs = await githubJson(env, `/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&per_page=10`);
    const list = Array.isArray(runs.workflow_runs) ? (runs.workflow_runs as Array<Record<string, unknown>>) : [];
    const matching = list.find((run) => {
      const title = String(run.display_title ?? '');
      return title.includes(job.id) || title.includes(job.job_key);
    }) ?? list[0];
    if (matching) {
      runId = String(matching.id ?? '');
      runUrl = String(matching.html_url ?? '');
    }
  }
  return { runId, runUrl };
}

async function createJob(
  env: Env,
  input: {
    operation: JobOperation;
    source: 'admin' | 'schedule';
    scope: BackupScope;
    archiveKey?: string;
    requestedBy?: string;
    extra?: Record<string, string>;
  },
): Promise<{ job: Record<string, unknown>; duplicate?: boolean; error?: string; status?: number }> {
  if (!env.DB) return { job: {}, error: 'database_not_configured', status: 503 };
  await syncRunningJob(env);
  const existing = await activeJob(env);
  if (existing) {
    return { job: backupJob(existing), duplicate: true, status: 409 };
  }
  if (input.operation !== 'backup' && !input.archiveKey) {
    return { job: {}, error: 'archive_key_required', status: 400 };
  }
  const id = `bj_${crypto.randomUUID()}`;
  const jobKey = `backup-job-${crypto.randomUUID()}`;
  const requestedAt = nowIso();
  const archiveKey = input.operation === 'backup' ? '' : String(input.archiveKey ?? '').trim();
  try {
    await env.DB.prepare(
      `INSERT INTO backup_control_jobs
       (id, job_key, operation, status, source, scope, archive_key,
        requested_by_admin_user_id, requested_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        jobKey,
        input.operation,
        input.source,
        input.scope,
        archiveKey,
        input.requestedBy ?? null,
        requestedAt,
        requestedAt,
      )
      .run();
  } catch (error) {
    const raced = await activeJob(env);
    if (raced) return { job: backupJob(raced), duplicate: true, status: 409 };
    return { job: {}, error: (error as Error).message || 'job_create_failed', status: 500 };
  }

  const row = await readJob(env, id);
  if (!row) return { job: {}, error: 'job_create_failed', status: 500 };
  try {
    const run = await dispatch(env, row, input.extra);
    await env.DB.prepare(
      `UPDATE backup_control_jobs
       SET status = 'running', github_run_id = ?, github_run_url = ?, started_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(run.runId, run.runUrl, requestedAt, nowIso(), id)
      .run();
    return { job: backupJob((await readJob(env, id)) ?? row) };
  } catch (error) {
    const message = (error as Error).message || 'github_dispatch_failed';
    await env.DB.prepare(
      `UPDATE backup_control_jobs
       SET status = 'failure', error = ?, summary = 'The backup could not be started.',
           finished_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(message.slice(0, 1000), nowIso(), nowIso(), id)
      .run();
    return { job: backupJob((await readJob(env, id)) ?? row), error: message, status: 502 };
  }
}

async function syncRunningJob(env: Env): Promise<void> {
  if (!env.DB) return;
  const job = await activeJob(env);
  if (!job || job.status !== 'running' || !job.github_run_id) return;
  try {
    const run = await githubJson(env, `/actions/runs/${encodeURIComponent(job.github_run_id)}`);
    if (String(run.status ?? '') !== 'completed') return;
    const conclusion = String(run.conclusion ?? '');
    const nextStatus: JobStatus = conclusion === 'success' ? 'success' : conclusion === 'cancelled' ? 'cancelled' : 'failure';
    await env.DB.prepare(
      `UPDATE backup_control_jobs
       SET status = ?, summary = CASE WHEN summary = '' THEN ? ELSE summary END,
           finished_at = COALESCE(finished_at, ?), updated_at = ?
       WHERE id = ? AND status IN ('queued','running')`,
    )
      .bind(
        nextStatus,
        nextStatus === 'failure' ? 'The GitHub backup run did not finish successfully.' : 'Backup run completed.',
        nowIso(),
        nowIso(),
        job.id,
      )
      .run();
  } catch {
    // A transient GitHub API failure must not rewrite a job. The callback or a
    // later poll will reconcile it.
  }
}

function scheduleDue(schedule: ScheduleRow, now: Date): boolean {
  if (!Number(schedule.enabled)) return false;
  if (now.getUTCHours() !== Number(schedule.utc_hour)) return false;
  if (now.getUTCMinutes() < Number(schedule.utc_minute) || now.getUTCMinutes() >= Number(schedule.utc_minute) + 15) {
    return false;
  }
  if (schedule.cadence === 'weekly' && now.getUTCDay() !== Number(schedule.day_of_week)) return false;
  if (schedule.cadence === 'monthly' && now.getUTCDate() !== Number(schedule.day_of_month)) return false;
  return true;
}

async function readSchedule(env: Env): Promise<ScheduleRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare("SELECT * FROM backup_schedule WHERE id = 'primary' LIMIT 1").first<ScheduleRow>();
}

async function runScheduled(env: Env): Promise<Record<string, unknown>> {
  const schedule = await readSchedule(env);
  if (!schedule || !scheduleDue(schedule, new Date())) return { ok: true, skipped: 'not_due' };
  if (await activeJob(env)) return { ok: true, skipped: 'job_already_active' };
  const today = new Date().toISOString().slice(0, 10);
  const last = env.DB
    ? await env.DB.prepare(
        "SELECT id FROM backup_control_jobs WHERE source = 'schedule' AND operation = 'backup' AND requested_at >= ? LIMIT 1",
      ).bind(`${today}T00:00:00.000Z`).first<{ id: string }>()
    : null;
  if (last) return { ok: true, skipped: 'already_ran_today' };
  const result = await createJob(env, {
    operation: 'backup',
    source: 'schedule',
    scope: schedule.scope === 'database' ? 'database' : 'complete',
    extra: {
      include_app_objects: schedule.scope === 'database' ? 'false' : 'true',
      retention_daily: String(schedule.retention_daily),
      retention_weekly: String(schedule.retention_weekly),
      retention_monthly: String(schedule.retention_monthly),
      apply_retention: 'true',
    },
  });
  return { ok: true, ...result };
}

function appBucket(env: Env, name: string): R2Bucket | undefined {
  if (name === 'documents') return env.DOCUMENTS_BUCKET;
  if (name === 'photos') return env.PHOTOS_BUCKET;
  return undefined;
}

async function appObjectList(env: Env, url: URL): Promise<Response> {
  const bucketName = url.searchParams.get('bucket') === 'photos' ? 'photos' : 'documents';
  const bucket = appBucket(env, bucketName);
  if (!bucket) return json({ ok: false, error: 'app_storage_not_configured' }, 503);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const page = await bucket.list({ cursor, limit: 1000 });
  return json({
    ok: true,
    bucket: bucketName,
    objects: page.objects.map((object) => ({ key: object.key, size: object.size })),
    truncated: page.truncated,
    cursor: page.truncated ? page.cursor ?? '' : '',
  });
}

async function appObjectGet(env: Env, url: URL): Promise<Response> {
  const bucketName = url.searchParams.get('bucket') === 'photos' ? 'photos' : 'documents';
  const bucket = appBucket(env, bucketName);
  if (!bucket) return json({ ok: false, error: 'app_storage_not_configured' }, 503);
  const key = url.searchParams.get('key') ?? '';
  if (!key || key.includes('..')) return json({ ok: false, error: 'object_key_invalid' }, 400);
  const object = await bucket.get(key);
  if (!object) return json({ ok: false, error: 'object_not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(object.size !== undefined ? { 'Content-Length': String(object.size) } : {}),
      'Cache-Control': 'no-store',
    },
  });
}

async function listArchives(env: Env): Promise<Record<string, unknown>> {
  if (!env.BACKUP_BUCKET) return { configured: false, archives: [], bytes: 0 };
  const archives: Array<Record<string, unknown>> = [];
  let totalBytes = 0;
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await env.BACKUP_BUCKET.list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 });
    for (const object of page.objects) {
      totalBytes += Number(object.size) || 0;
      if (object.key.endsWith('.ssbk')) {
        archives.push({
          key: object.key,
          name: object.key.split('/').pop() ?? object.key,
          bytes: object.size,
          uploadedAt: object.uploaded instanceof Date ? object.uploaded.toISOString() : null,
        });
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages += 1;

    if (pages >= 20) break;
  } while (cursor);
  archives.sort((a, b) => String(b.uploadedAt ?? '').localeCompare(String(a.uploadedAt ?? '')));
  return { configured: true, archives: archives.slice(0, 200), bytes: totalBytes, truncated: pages >= 20 };
}

async function overview(env: Env): Promise<Record<string, unknown>> {
  await syncRunningJob(env);
  const schedule = await readSchedule(env);
  const jobs = env.DB
    ? (await env.DB.prepare(
        'SELECT * FROM backup_control_jobs ORDER BY requested_at DESC LIMIT 25',
      ).all<JobRow>()).results ?? []
    : [];
  const storage = await listArchives(env);
  return {
    ok: true,
    configured: Boolean(env.GITHUB_DISPATCH_TOKEN && env.BACKUP_CONTROL_TOKEN && env.DB && env.BACKUP_BUCKET),
    schedule: schedule
      ? {
          enabled: Boolean(schedule.enabled),
          cadence: schedule.cadence,
          utcHour: Number(schedule.utc_hour),
          utcMinute: Number(schedule.utc_minute),
          dayOfWeek: Number(schedule.day_of_week),
          dayOfMonth: Number(schedule.day_of_month),
          scope: schedule.scope,
          retentionDaily: Number(schedule.retention_daily),
          retentionWeekly: Number(schedule.retention_weekly),
          retentionMonthly: Number(schedule.retention_monthly),
        }
      : null,
    activeJob: jobs.find((job) => job.status === 'queued' || job.status === 'running')
      ? backupJob(jobs.find((job) => job.status === 'queued' || job.status === 'running')!)
      : null,
    jobs: jobs.map(backupJob),
    storage,
    checkedAt: nowIso(),
  };
}

async function saveSchedule(env: Env, body: Record<string, unknown>, actor: string): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 503);
  const cadence = ['daily', 'weekly', 'monthly'].includes(String(body.cadence)) ? String(body.cadence) : 'daily';
  const hour = Math.max(0, Math.min(23, Math.round(Number(body.utcHour) || 0)));
  const minute = Math.max(0, Math.min(59, Math.round(Number(body.utcMinute) || 0)));
  const dayOfWeek = Math.max(0, Math.min(6, Math.round(Number(body.dayOfWeek) || 0)));
  const dayOfMonth = Math.max(1, Math.min(28, Math.round(Number(body.dayOfMonth) || 1)));
  const scope = body.scope === 'database' ? 'database' : 'complete';
  const retentionDaily = Math.max(1, Math.min(365, Math.round(Number(body.retentionDaily) || 30)));
  const retentionWeekly = Math.max(1, Math.min(104, Math.round(Number(body.retentionWeekly) || 12)));
  const retentionMonthly = Math.max(1, Math.min(120, Math.round(Number(body.retentionMonthly) || 12)));
  await env.DB.prepare(
    `UPDATE backup_schedule
     SET enabled = ?, cadence = ?, utc_hour = ?, utc_minute = ?, day_of_week = ?,
         day_of_month = ?, scope = ?, retention_daily = ?, retention_weekly = ?,
         retention_monthly = ?, updated_by_admin_user_id = ?, updated_at = ?
     WHERE id = 'primary'`,
  )
    .bind(
      body.enabled === false ? 0 : 1,
      cadence,
      hour,
      minute,
      dayOfWeek,
      dayOfMonth,
      scope,
      retentionDaily,
      retentionWeekly,
      retentionMonthly,
      actor || null,
      nowIso(),
    )
    .run();
  return json({ ok: true, schedule: await readSchedule(env) });
}

async function signDownload(env: Env, key: string, origin: string): Promise<{ url: string; expiresAt: string }> {
  const secret = env.BACKUP_CONTROL_TOKEN?.trim();
  if (!secret) throw new Error('backup_control_not_configured');
  if (!key.startsWith(`${BACKUP_PREFIX}/`) || key.includes('..')) throw new Error('archive_key_invalid');
  const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
  const payload = `${key}|${expires}`;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return {
    url: `${origin}/download?key=${encodeURIComponent(key)}&expires=${expires}&signature=${signature}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

async function verifyDownload(env: Env, url: URL): Promise<boolean> {
  const key = url.searchParams.get('key') ?? '';
  const expires = Number(url.searchParams.get('expires') ?? 0);
  const signature = url.searchParams.get('signature') ?? '';
  const secret = env.BACKUP_CONTROL_TOKEN?.trim();
  if (!secret || !key || !signature || !Number.isFinite(expires)) return false;
  if (expires < Math.floor(Date.now() / 1000)) return false;
  if (!key.startsWith(`${BACKUP_PREFIX}/`) || key.includes('..')) return false;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = [...new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${key}|${expires}`)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return expected === signature;
}

async function callback(env: Env, body: Record<string, unknown>): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 503);
  const jobId = String(body.jobId ?? '').trim();
  if (!jobId) return json({ ok: false, error: 'job_id_required' }, 400);
  const job = await readJob(env, jobId);
  if (!job || job.status === 'success' || job.status === 'failure' || job.status === 'cancelled') {
    return json({ ok: true, ignored: true });
  }
  const status = body.status === 'success' ? 'success' : body.status === 'cancelled' ? 'cancelled' : 'failure';
  const summary = String(body.summary ?? '').slice(0, 2000);
  const detail = JSON.stringify(body.detail ?? {}).slice(0, 50_000);
  const error = String(body.error ?? '').slice(0, 2000);
  const archiveKey = String(body.archiveKey ?? job.archive_key ?? '').slice(0, 500);
  await env.DB.prepare(
    `UPDATE backup_control_jobs
     SET status = ?, summary = ?, detail_json = ?, error = ?, archive_key = ?,
         finished_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(status, summary, detail, error, archiveKey, nowIso(), nowIso(), jobId)
    .run();
  if (job.operation === 'backup' || job.operation === 'restore_test') {
    await env.DB.prepare(
      `INSERT INTO backup_runs (id, run_key, status, summary, detail_json, started_at, finished_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_key) DO UPDATE SET status = excluded.status, summary = excluded.summary,
         detail_json = excluded.detail_json, finished_at = excluded.finished_at,
         recorded_at = excluded.recorded_at`,
    )
      .bind(
        `br_${crypto.randomUUID()}`,
        `admin-${jobId}`,
        status === 'success' ? 'success' : 'failure',
        summary || `${job.operation} ${status}`,
        detail,
        job.started_at,
        nowIso(),
        nowIso(),
      )
      .run()
      .catch(() => undefined);
  }
  return json({ ok: true });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/download' && request.method === 'GET') {
    if (!(await verifyDownload(env, url))) return json({ ok: false, error: 'download_link_invalid' }, 403);
    if (!env.BACKUP_BUCKET) return json({ ok: false, error: 'backup_storage_not_configured' }, 503);
    const key = url.searchParams.get('key') ?? '';
    const object = await env.BACKUP_BUCKET.get(key);
    if (!object) return json({ ok: false, error: 'archive_not_found' }, 404);
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${key.split('/').pop() ?? 'backup.ssbk'}"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  if (url.pathname === '/callback' && request.method === 'POST') {
    if (!authorised(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return callback(env, body);
  }
  if (!authorised(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, configured: Boolean(env.GITHUB_DISPATCH_TOKEN && env.DB && env.BACKUP_BUCKET) });
  }
  if (url.pathname === '/overview' && request.method === 'GET') {
    return json(await overview(env));
  }
  if (url.pathname === '/archives' && request.method === 'GET') {
    return json({ ok: true, ...(await listArchives(env)) });
  }
  if (url.pathname === '/app-objects/list' && request.method === 'GET') {
    return appObjectList(env, url);
  }
  if (url.pathname === '/app-objects/get' && request.method === 'GET') {
    return appObjectGet(env, url);
  }
  if (url.pathname === '/jobs' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const operation: JobOperation = body.operation === 'verify'
      ? 'verify'
      : body.operation === 'restore_test'
        ? 'restore_test'
        : 'backup';
    const scope: BackupScope = body.scope === 'database' ? 'database' : 'complete';
    const archiveKey = String(body.archiveKey ?? '').trim();
    const result = await createJob(env, {
      operation,
      source: 'admin',
      scope,
      archiveKey,
      requestedBy: String(body.requestedBy ?? '').trim() || undefined,
      extra: {
        include_app_objects: scope === 'database' ? 'false' : 'true',
        retention_daily: String(Math.max(1, Math.min(365, Number(body.retentionDaily) || 30))),
        retention_weekly: String(Math.max(1, Math.min(104, Number(body.retentionWeekly) || 12))),
        retention_monthly: String(Math.max(1, Math.min(120, Number(body.retentionMonthly) || 12))),
        apply_retention: body.applyRetention === false ? 'false' : 'true',
        ...(archiveKey ? { archive_key: archiveKey } : {}),
      },
    });
    if (result.duplicate) {
      return json({ ok: false, error: 'backup_job_already_active', job: result.job }, 409);
    }
    if (result.error) return json({ ok: false, error: result.error }, result.status ?? 500);
    return json({ ok: true, job: result.job });
  }
  if (url.pathname === '/schedule' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return saveSchedule(env, body, String(body.requestedBy ?? '').trim());
  }
  if (url.pathname === '/download-link' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return json({ ok: true, ...(await signDownload(env, String(body.key ?? ''), `${url.protocol}//${url.host}`)) });
    } catch (error) {
      return json({ ok: false, error: (error as Error).message || 'download_link_failed' }, 400);
    }
  }
  if (url.pathname.startsWith('/jobs/') && request.method === 'GET') {
    const id = url.pathname.slice('/jobs/'.length);
    const job = await readJob(env, id);
    if (!job) return json({ ok: false, error: 'job_not_found' }, 404);
    return json({ ok: true, job: backupJob(job) });
  }
  return json({ ok: false, error: 'not_found' }, 404);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env).then((result) => console.log(JSON.stringify({ event: 'backup_schedule', ...result }))));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      return json({ ok: false, error: (error as Error).message || 'backup_control_failed' }, 500);
    }
  },
};


