// Owner-only backup control center proxy. The browser never receives the
// GitHub, R2 or control-plane credentials. Pages authenticates the existing
// owner session, CSRF and step-up, then calls the dedicated backup Worker.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf, requireStepUp } from '../../../src/lib/admin/operations.ts';

interface Env extends AdminDbEnv {
  BACKUP_CONTROL_URL?: string;
  BACKUP_CONTROL_TOKEN?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function controlUrl(env: Env, path: string): string {
  const base = (env.BACKUP_CONTROL_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new AdminAuthError(503, 'backup_control_not_configured');
  return `${base}${path}`;
}

async function worker(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const token = (env.BACKUP_CONTROL_TOKEN ?? '').trim();
  if (!token) throw new AdminAuthError(503, 'backup_control_not_configured');
  const response = await fetch(controlUrl(env, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  return response;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const response = await worker(context.env, '/overview');
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'backup_status_failed' },
      error instanceof AdminAuthError ? error.status : 502,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    requireCsrf(context.request, actor);
    requireStepUp(actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    if (action === 'start_backup') {
      const scope = body.scope === 'database' ? 'database' : 'complete';
      const response = await worker(context.env, '/jobs', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'backup',
          scope,
          requestedBy: actor.id,
          retentionDaily: body.retentionDaily,
          retentionWeekly: body.retentionWeekly,
          retentionMonthly: body.retentionMonthly,
          applyRetention: body.applyRetention !== false,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        await audit(db, {
          actorUserId: actor.id,
          action: 'backup.started',
          entityType: 'backup_job',
          entityId: text(result.job && (result.job as Record<string, unknown>).id, 100),
          detail: `scope=${scope}`,
        });
      }
      return json(result, response.status);
    }
    if (action === 'verify_archive') {
      const archiveKey = text(body.archiveKey, 500);
      if (!archiveKey) return json({ ok: false, error: 'archive_key_required' }, 400);
      const response = await worker(context.env, '/jobs', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'verify',
          scope: 'database',
          archiveKey,
          requestedBy: actor.id,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        await audit(db, {
          actorUserId: actor.id,
          action: 'backup.verify_requested',
          entityType: 'backup_archive',
          entityId: archiveKey,
        });
      }
      return json(result, response.status);
    }
    if (action === 'restore_test') {
      const archiveKey = text(body.archiveKey, 500);
      if (!archiveKey) return json({ ok: false, error: 'archive_key_required' }, 400);
      const response = await worker(context.env, '/jobs', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'restore_test',
          scope: 'database',
          archiveKey,
          requestedBy: actor.id,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        await audit(db, {
          actorUserId: actor.id,
          action: 'backup.restore_test_requested',
          entityType: 'backup_archive',
          entityId: archiveKey,
        });
      }
      return json(result, response.status);
    }
    if (action === 'save_schedule') {
      const response = await worker(context.env, '/schedule', {
        method: 'POST',
        body: JSON.stringify({
          enabled: body.enabled !== false,
          cadence: body.cadence,
          utcHour: body.utcHour,
          utcMinute: body.utcMinute,
          dayOfWeek: body.dayOfWeek,
          dayOfMonth: body.dayOfMonth,
          scope: body.scope,
          retentionDaily: body.retentionDaily,
          retentionWeekly: body.retentionWeekly,
          retentionMonthly: body.retentionMonthly,
          requestedBy: actor.id,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        await audit(db, {
          actorUserId: actor.id,
          action: 'backup.schedule_updated',
          entityType: 'backup_schedule',
          entityId: 'primary',
          detail: `${text(body.cadence, 20)}:${text(body.scope, 20)}`,
        });
      }
      return json(result, response.status);
    }
    if (action === 'download') {
      const archiveKey = text(body.archiveKey, 500);
      if (!archiveKey) return json({ ok: false, error: 'archive_key_required' }, 400);
      const response = await worker(context.env, '/download-link', {
        method: 'POST',
        body: JSON.stringify({ key: archiveKey }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        await audit(db, {
          actorUserId: actor.id,
          action: 'backup.download_link_created',
          entityType: 'backup_archive',
          entityId: archiveKey,
        });
      }
      return json(result, response.status);
    }
    return json({ ok: false, error: 'backup_action_invalid' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'backup_action_failed' },
      error instanceof AdminAuthError ? error.status : 502,
    );
  }
}
