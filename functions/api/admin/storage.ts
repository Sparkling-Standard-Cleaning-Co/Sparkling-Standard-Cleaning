// Owner-only Data & Storage dashboard and safe exports.
// Full encrypted off-site backups remain a CLI/private-master operation; this
// endpoint never attempts to hold an entire R2 archive in one request.

import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { isPhotoKey, isPhotoSidecarKey } from '../../../src/lib/photos.ts';

interface R2Object {
  key: string;
  uploaded?: Date;
}
interface R2Bucket {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}
interface Env extends AdminDbEnv {
  PHOTOS_BUCKET?: R2Bucket;
  DOCUMENTS_BUCKET?: R2Bucket;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function count(db: D1Database, table: string): Promise<number | null> {
  try {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first<{ count: number }>();
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

async function r2Summary(bucket: R2Bucket | undefined, prefixes: string[]): Promise<{
  configured: boolean;
  sampledObjects: number;
  truncated: boolean;
}> {
  if (!bucket) return { configured: false, sampledObjects: 0, truncated: false };
  let sampled = 0;
  let truncated = false;
  for (const prefix of prefixes) {
    try {
      const page = await bucket.list({ prefix, limit: 1000 });
      sampled += page.objects.length;
      if (page.truncated) truncated = true;
    } catch {
      // A list failure never invents a count.
    }
  }
  return { configured: true, sampledObjects: sampled, truncated };
}

async function cleanupPhotos(
  bucket: R2Bucket | undefined,
  retentionDays: number,
  dryRun: boolean,
): Promise<{ retentionDays: number; dryRun: boolean; scanned: number; eligible: number; deleted: number }> {
  if (!bucket) throw new AdminAuthError(503, 'photo_storage_not_configured');
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let cursor: string | undefined;
  let scanned = 0;
  let eligible = 0;
  let deleted = 0;
  let pages = 0;
  const pending: string[] = [];
  do {
    const page = await bucket.list({ prefix: 'leads/', limit: 500, ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      scanned += 1;
      if (!isPhotoKey(object.key) && !isPhotoSidecarKey(object.key)) continue;
      const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : Number.NaN;
      if (!Number.isFinite(uploaded) || uploaded >= cutoff) continue;
      eligible += 1;
      pending.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages += 1;
    if (!dryRun) {
      while (pending.length >= 200) {
        await bucket.delete(pending.splice(0, 200));
        deleted += 200;
      }
    }
    if (pages >= 20) break;
  } while (cursor);
  if (!dryRun && pending.length > 0) {
    const remaining = pending.splice(0);
    await bucket.delete(remaining);
    deleted += remaining.length;
  }
  return { retentionDays, dryRun, scanned, eligible, deleted };
}

function csvValue(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function csv(db: D1Database, kind: string): Promise<{ filename: string; body: string }> {
  const queries: Record<string, { filename: string; sql: string }> = {
    customers: {
      filename: 'customers.csv',
      sql: `SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, b.name AS branch,
                   (SELECT value FROM customer_contacts cc WHERE cc.customer_id=c.id AND cc.kind='email' LIMIT 1) AS email,
                   (SELECT value FROM customer_contacts cc WHERE cc.customer_id=c.id AND cc.kind='phone' LIMIT 1) AS phone,
                   c.created_at
            FROM customers c LEFT JOIN branches b ON b.id=c.primary_branch_id ORDER BY c.created_at LIMIT 5000`,
    },
    properties: {
      filename: 'properties.csv',
      sql: `SELECT id, customer_id, label, line1, line2, city, state, postal_code, status, created_at
            FROM properties ORDER BY created_at LIMIT 5000`,
    },
    appointments: {
      filename: 'appointments.csv',
      sql: `SELECT id, reference, customer_id, property_id, status, start_at, end_at, duration_minutes, created_at
            FROM appointments ORDER BY start_at LIMIT 5000`,
    },
    invoices: {
      filename: 'invoices.csv',
      sql: `SELECT id, number, customer_id, status, issue_date, due_date, total_cents, amount_paid_cents, balance_cents, created_at
            FROM invoices ORDER BY created_at LIMIT 5000`,
    },
  };
  const query = queries[kind];
  if (!query) throw new AdminAuthError(400, 'export_kind_invalid');
  const rows = await db.prepare(query.sql).all<Record<string, unknown>>();
  const records = rows.results ?? [];
  const headers = records.length > 0 ? Object.keys(records[0]!) : [];
  const body = [
    headers.map(csvValue).join(','),
    ...records.map((record) => headers.map((header) => csvValue(record[header])).join(',')),
  ].join('\n');
  return { filename: query.filename, body };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const url = new URL(context.request.url);
    const exportKind = url.searchParams.get('export') ?? '';
    if (exportKind) {
      const file = await csv(db, exportKind);
      await audit(db, {
        actorUserId: actor.id,
        action: 'storage.business_records_exported',
        entityType: 'export',
        entityId: exportKind,
      }).catch(() => undefined);
      return new Response(file.body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file.filename}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    let databaseBytes: number | null = null;
    try {
      const size = await db
        .prepare('SELECT (SELECT page_count FROM pragma_page_count()) * (SELECT page_size FROM pragma_page_size()) AS bytes')
        .first<{ bytes: number }>();
      databaseBytes = Number(size?.bytes ?? 0) || null;
    } catch {
      databaseBytes = null;
    }
    const [customers, properties, appointments, invoices, documents, photos, settings] = await Promise.all([
      count(db, 'customers'),
      count(db, 'properties'),
      count(db, 'appointments'),
      count(db, 'invoices'),
      count(db, 'document_templates'),
      count(db, 'document_signatures'),
      db.prepare("SELECT key, value_json, updated_at FROM admin_settings WHERE key LIKE 'backup.%' OR key LIKE 'storage.%' ORDER BY key").all<Record<string, unknown>>().catch(() => ({ results: [] })),
    ]);
    return json({
      ok: true,
      database: {
        configured: true,
        bytes: databaseBytes,
        counts: { customers, properties, appointments, invoices, documents, photos },
      },
      storage: {
        photos: await r2Summary(context.env.PHOTOS_BUCKET, ['leads/']),
        documents: await r2Summary(context.env.DOCUMENTS_BUCKET, ['agreements/']),
      },
      settings: settings.results ?? [],
      note:
        'Provider free-tier usage and R2 byte totals require Cloudflare account analytics. Counts above are sampled/D1-derived; no universal capacity percentage is invented.',
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'storage_failed' },
      error instanceof AdminAuthError ? error.status : 500,
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
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'photo_cleanup') {
      const result = await cleanupPhotos(
        context.env.PHOTOS_BUCKET,
        Math.min(365, Math.max(1, Number(body.days) || 30)),
        body.dryRun !== false,
      );
      await db
        .prepare(
          `INSERT INTO admin_settings (key, value_json, updated_by_admin_user_id, updated_at)
           VALUES ('storage.photo_cleanup_last', ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,
             updated_by_admin_user_id=excluded.updated_by_admin_user_id, updated_at=CURRENT_TIMESTAMP`,
        )
        .bind(JSON.stringify({ ...result, at: new Date().toISOString() }), actor.id)
        .run()
        .catch(() => undefined);
      await audit(db, {
        actorUserId: actor.id,
        action: result.dryRun ? 'storage.photo_cleanup_preview' : 'storage.photo_cleanup_run',
        entityType: 'storage',
        entityId: 'photos',
        detail: `eligible=${result.eligible};deleted=${result.deleted}`,
      });
      return json({ ok: true, ...result });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'storage_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
