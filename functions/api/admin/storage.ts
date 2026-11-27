// Owner-only Data & Storage dashboard and safe exports.
// Full encrypted off-site backups remain a CLI/private-master operation; this
// endpoint never attempts to hold an entire R2 archive in one request.

import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf, requireStepUp } from '../../../src/lib/admin/operations.ts';
import { isPhotoKey } from '../../../src/lib/photos.ts';

interface R2Object {
  key: string;
  uploaded?: Date;
  size?: number;
}
interface R2Bucket {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

interface PhotoOwner {
  ref: string;
  leadId: string;
  customerId: string;
  propertyId: string;
  customer: string;
  property: string;
  status: string;
}

const PHOTO_REF_PATTERN = /^leads\/\d{4}\/\d{2}\/([a-z0-9-]{8,40})\//;

function photoRef(key: string): string {
  return PHOTO_REF_PATTERN.exec(key)?.[1] ?? '';
}

function placeholders(values: string[]): string {
  return values.map(() => '?').join(',');
}

async function photoOwners(db: D1Database, refs: string[]): Promise<Map<string, PhotoOwner>> {
  const owners = new Map<string, PhotoOwner>();
  const unique = [...new Set(refs.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 40) {
    const chunk = unique.slice(index, index + 40);
    try {
      const rows = await db
        .prepare(
          `SELECT l.id, l.quote_reference, l.customer_id, l.property_id, l.status,
                  TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS customer_name,
                  COALESCE(NULLIF(c.company_name,''), p.label, '') AS property_label
           FROM leads l
           LEFT JOIN customers c ON c.id = l.customer_id
           LEFT JOIN properties p ON p.id = l.property_id
           WHERE l.quote_reference IN (${placeholders(chunk)})`,
        )
        .bind(...chunk)
        .all<Record<string, unknown>>();
      for (const row of rows.results ?? []) {
        const ref = String(row.quote_reference ?? '');
        if (!ref || owners.has(ref)) continue;
        owners.set(ref, {
          ref,
          leadId: String(row.id ?? ''),
          customerId: String(row.customer_id ?? ''),
          propertyId: String(row.property_id ?? ''),
          customer: String(row.customer_name ?? '').trim() || 'Unlinked customer',
          property: String(row.property_label ?? '').trim(),
          status: String(row.status ?? ''),
        });
      }
    } catch {
      // Never delete or classify photos when ownership cannot be established.
      throw new AdminAuthError(503, 'photo_ownership_unavailable');
    }
  }
  return owners;
}

async function activeHoldSubjects(db: D1Database): Promise<Set<string>> {
  try {
    const rows = await db
      .prepare("SELECT subject_id FROM legal_holds WHERE status = 'active'")
      .all<{ subject_id: string }>();
    return new Set((rows.results ?? []).map((row) => String(row.subject_id ?? '')).filter(Boolean));
  } catch {
    // Fail closed: if holds cannot be read, no photo may be deleted.
    throw new AdminAuthError(503, 'legal_holds_unavailable');
  }
}

function refProtected(ref: string, owner: PhotoOwner | undefined, held: Set<string>): boolean {
  if (!ref) return true;
  if (held.has(ref)) return true;
  if (!owner) return false;
  return held.has(owner.leadId) || held.has(owner.customerId) || held.has(owner.propertyId);
}

async function listPhotoObjects(bucket: R2Bucket | undefined): Promise<{
  objects: R2Object[];
  truncated: boolean;
}> {
  if (!bucket) throw new AdminAuthError(503, 'photo_storage_not_configured');
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await bucket.list({ prefix: 'leads/', limit: 500, ...(cursor ? { cursor } : {}) });
    objects.push(...page.objects.filter((object) => isPhotoKey(object.key)));
    cursor = page.truncated ? page.cursor : undefined;
    pages += 1;
    if (pages >= 20) break;
  } while (cursor);
  return { objects, truncated: Boolean(cursor) };
}

async function photoInventory(db: D1Database, bucket: R2Bucket | undefined): Promise<{
  configured: boolean;
  photos: Array<Record<string, unknown>>;
  total: number;
  truncated: boolean;
  protectedCount: number;
}> {
  if (!bucket) return { configured: false, photos: [], total: 0, truncated: false, protectedCount: 0 };
  const { objects, truncated } = await listPhotoObjects(bucket);
  const owners = await photoOwners(db, objects.map((object) => photoRef(object.key)));
  const held = await activeHoldSubjects(db);
  const photos = objects.map((object) => {
    const ref = photoRef(object.key);
    const owner = owners.get(ref);
    const filename = object.key.split('/').pop() ?? '';
    return {
      key: object.key,
      ref,
      category: filename.split('-')[0] ?? '',
      uploadedAt: object.uploaded instanceof Date ? object.uploaded.toISOString() : null,
      bytes: Number(object.size ?? 0) || null,
      customer: owner?.customer ?? 'Unlinked photo',
      property: owner?.property ?? '',
      leadId: owner?.leadId ?? '',
      leadStatus: owner?.status ?? '',
      protected: refProtected(ref, owner, held),
    };
  }).sort((a, b) => String(b.uploadedAt ?? '').localeCompare(String(a.uploadedAt ?? '')));
  return {
    configured: true,
    photos: photos.slice(0, 300),
    total: photos.length,
    truncated: truncated || photos.length > 300,
    protectedCount: photos.filter((photo) => photo.protected).length,
  };
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

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function count(db: D1Database, table: string, branchColumn = '', branch = ''): Promise<number | null> {
  try {
    const scoped = branchColumn && branch
      ? await db.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE "${branchColumn}" = ?`).bind(branch).first<{ count: number }>()
      : await db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first<{ count: number }>();
    return Number(scoped?.count ?? 0);
  } catch {
    return null;
  }
}

function exportBranch(value: string | null): string {
  return ['branch_pensacola', 'branch_tampa'].includes(value ?? '') ? String(value) : '';
}

function branchFilter(branch: string, column: string): { sql: string; bind: string[] } {
  return branch ? { sql: ` AND ${column} = ?`, bind: [branch] } : { sql: '', bind: [] };
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
  db: D1Database,
  bucket: R2Bucket | undefined,
  retentionDays: number,
  dryRun: boolean,
): Promise<{
  retentionDays: number;
  dryRun: boolean;
  scanned: number;
  eligible: number;
  protectedEligible: number;
  deleted: number;
}> {
  if (!bucket) throw new AdminAuthError(503, 'photo_storage_not_configured');
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let cursor: string | undefined;
  let scanned = 0;
  let pages = 0;
  const photoObjects: R2Object[] = [];
  const allKeys = new Set<string>();
  do {
    const page = await bucket.list({ prefix: 'leads/', limit: 500, ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      allKeys.add(object.key);
      scanned += 1;
      if (isPhotoKey(object.key)) photoObjects.push(object);
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages += 1;
    if (pages >= 20) break;
  } while (cursor);

  const owners = await photoOwners(db, photoObjects.map((object) => photoRef(object.key)));
  const held = await activeHoldSubjects(db);
  let eligible = 0;
  let protectedEligible = 0;
  const pendingPhotos: string[] = [];
  const pendingKeys: string[] = [];
  for (const object of photoObjects) {
    const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : Number.NaN;
    if (!Number.isFinite(uploaded) || uploaded >= cutoff) continue;
    eligible += 1;
    const ref = photoRef(object.key);
    if (refProtected(ref, owners.get(ref), held)) {
      protectedEligible += 1;
      continue;
    }
    pendingPhotos.push(object.key);
    pendingKeys.push(object.key);
    const sidecar = `${object.key}.meta.json`;
    if (allKeys.has(sidecar)) pendingKeys.push(sidecar);
  }

  let deleted = 0;
  if (!dryRun) {
    for (let index = 0; index < pendingPhotos.length; index += 200) {
      const batchPhotos = new Set(pendingPhotos.slice(index, index + 200));
      const batch = pendingKeys.filter((key) => batchPhotos.has(key.replace(/\.meta\.json$/, '')));
      await bucket.delete(batch);
      deleted += batchPhotos.size;
    }
  }
  return { retentionDays, dryRun, scanned, eligible, protectedEligible, deleted };
}

function csvValue(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function csv(
  db: D1Database,
  kind: string,
  branch = '',
): Promise<{ filename: string; body: string; rows: Array<Record<string, unknown>>; headers: string[] }> {
  const definitions: Record<string, { filename: string; sql: string; column: string }> = {
    customers: {
      filename: 'customers.csv',
      column: 'c.primary_branch_id',
      sql: `SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, b.name AS branch,
                   (SELECT value FROM customer_contacts cc WHERE cc.customer_id=c.id AND cc.kind='email' LIMIT 1) AS email,
                   (SELECT value FROM customer_contacts cc WHERE cc.customer_id=c.id AND cc.kind='phone' LIMIT 1) AS phone,
                   c.created_at
            FROM customers c LEFT JOIN branches b ON b.id=c.primary_branch_id
            WHERE c.source <> 'financial_system'{{BRANCH}} ORDER BY c.created_at LIMIT 5000`,
    },
    properties: {
      filename: 'properties.csv',
      column: 'branch_id',
      sql: `SELECT id, customer_id, label, line1, line2, city, state, postal_code, status, created_at
            FROM properties WHERE 1=1{{BRANCH}} ORDER BY created_at LIMIT 5000`,
    },
    appointments: {
      filename: 'appointments.csv',
      column: 'branch_id',
      sql: `SELECT id, reference, customer_id, property_id, status, start_at, end_at, duration_minutes, created_at
            FROM appointments WHERE 1=1{{BRANCH}} ORDER BY start_at LIMIT 5000`,
    },
    invoices: {
      filename: 'invoices.csv',
      column: 'branch_id',
      sql: `SELECT id, number, customer_id, status, issue_date, due_date, total_cents, amount_paid_cents, balance_cents, created_at
            FROM invoices WHERE 1=1{{BRANCH}} ORDER BY created_at LIMIT 5000`,
    },
    signatures: {
      filename: 'signing-evidence.csv',
      column: 'sr.branch_id',
      sql: `SELECT s.id AS signature_id, sr.id AS signing_request_id, sr.bundle_code, sr.status AS request_status,
                   t.title, t.version AS template_version, s.signer_name, s.signer_email, s.status AS signature_status,
                   s.signed_at, s.signed_ip_hash, s.signed_user_agent_hash, s.signed_content_sha256,
                   sr.executed_at, sr.executed_sha256
            FROM document_signatures s
            JOIN signing_requests sr ON sr.id = s.signing_request_id
            JOIN document_templates t ON t.id = s.template_id
            WHERE 1=1{{BRANCH}} ORDER BY s.signed_at DESC LIMIT 5000`,
    },
  };
  const query = definitions[kind];
  if (!query) throw new AdminAuthError(400, 'export_kind_invalid');
  const filter = branchFilter(branch, query.column);
  const statement = db.prepare(query.sql.replace('{{BRANCH}}', filter.sql));
  const rows = filter.bind.length ? await statement.bind(...filter.bind).all<Record<string, unknown>>() : await statement.all<Record<string, unknown>>();
  const records = rows.results ?? [];
  const headers = records.length > 0 ? Object.keys(records[0]!) : [];
  const body = [
    headers.map(csvValue).join(','),
    ...records.map((record) => headers.map((header) => csvValue(record[header])).join(',')),
  ].join('\n');
  const suffix = branch ? `-${branch.replace('branch_', '')}` : '';
  return { filename: query.filename.replace('.csv', `${suffix}.csv`), body, rows: records, headers };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const url = new URL(context.request.url);
    const exportKind = url.searchParams.get('export') ?? '';
    const branch = exportBranch(url.searchParams.get('branch'));
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
    if (exportKind) {
      requireStepUp(actor);
      const file = await csv(db, exportKind, branch);
      await audit(db, {
        actorUserId: actor.id,
        action: 'storage.business_records_exported',
        entityType: 'export',
        entityId: exportKind,
        detail: `${format}:${branch || 'all'}:${file.rows.length}`,
      }).catch(() => undefined);
      if (format === 'json') {
        return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), branch: branch || 'all', kind: exportKind, records: file.rows }, null, 2), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${file.filename.replace(/\.csv$/, '.json')}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      return new Response(file.body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file.filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (url.searchParams.get('view') === 'photos') {
      return json({ ok: true, ...(await photoInventory(db, context.env.PHOTOS_BUCKET)) });
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
    const requestedBranch = exportBranch(url.searchParams.get('branch'));
    const [customers, properties, appointments, invoices, documents, photos, settings, backupRuns, incidents, retention, holds] = await Promise.all([
      count(db, 'customers', 'primary_branch_id', requestedBranch),
      count(db, 'properties', 'branch_id', requestedBranch),
      count(db, 'appointments', 'branch_id', requestedBranch),
      count(db, 'invoices', 'branch_id', requestedBranch),
      count(db, 'document_templates'),
      count(db, 'document_signatures'),
      db.prepare("SELECT key, value_json, updated_at FROM admin_settings WHERE key LIKE 'backup.%' OR key LIKE 'storage.%' OR key LIKE 'communications.%' ORDER BY key").all<Record<string, unknown>>().catch(() => ({ results: [] })),
      db.prepare('SELECT run_key, status, summary, recorded_at FROM backup_runs ORDER BY recorded_at DESC LIMIT 5').all<Record<string, unknown>>().catch(() => ({ results: [] })),
      db.prepare("SELECT id, incident_key, status, summary, opened_at, escalation_sent_at, resolved_at FROM operations_incidents WHERE status <> 'resolved' ORDER BY opened_at DESC LIMIT 20").all<Record<string, unknown>>().catch(() => ({ results: [] })),
      db.prepare('SELECT * FROM retention_policies ORDER BY record_type').all<Record<string, unknown>>().catch(() => ({ results: [] })),
      db.prepare('SELECT id, subject_type, subject_id, reason, status, created_at, released_at FROM legal_holds ORDER BY created_at DESC LIMIT 100').all<Record<string, unknown>>().catch(() => ({ results: [] })),
    ]);
    let holdOptions: Array<{ type: string; id: string; label: string }> = [];
    try {
      const [customerRows, propertyRows, appointmentRows] = await Promise.all([
        db.prepare(
          `SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name, company_name
           FROM customers WHERE status = 'active' ORDER BY last_name, first_name LIMIT 500`,
        ).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT p.id, COALESCE(NULLIF(p.label,''), p.line1, 'Property') AS label, p.city,
                  TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS customer_name
           FROM properties p LEFT JOIN customers c ON c.id = p.customer_id
           WHERE p.status = 'active' ORDER BY p.label LIMIT 500`,
        ).all<Record<string, unknown>>(),
        db.prepare(
          `SELECT a.id, a.reference, a.start_at,
                  TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS customer_name
           FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id
           WHERE a.status NOT IN ('canceled','cancelled') ORDER BY a.start_at DESC LIMIT 500`,
        ).all<Record<string, unknown>>(),
      ]);
      const customerName = (value: unknown): string => String(value ?? '').trim() || 'Customer';
      for (const row of customerRows.results ?? []) {
        holdOptions.push({
          type: 'customer',
          id: String(row.id ?? ''),
          label: `${customerName(row.name)}${row.company_name ? ` — ${String(row.company_name)}` : ''}`,
        });
      }
      for (const row of propertyRows.results ?? []) {
        holdOptions.push({
          type: 'property',
          id: String(row.id ?? ''),
          label: `${customerName(row.customer_name)} — ${String(row.label ?? 'Property')}${row.city ? `, ${String(row.city)}` : ''}`,
        });
      }
      for (const row of appointmentRows.results ?? []) {
        holdOptions.push({
          type: 'booking',
          id: String(row.id ?? ''),
          label: `${customerName(row.customer_name)} — ${String(row.reference ?? 'Booking')}${row.start_at ? ` (${new Date(String(row.start_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : ''}`,
        });
      }
      holdOptions = holdOptions.filter((option) => option.id);
    } catch {
      holdOptions = [];
    }
    return json({
      ok: true,
      branch: requestedBranch || 'all',
      holdOptions,
      database: {
        configured: true,
        bytes: databaseBytes,
        counts: { customers, properties, appointments, invoices, documents, photos },
      },
      storage: {
        photos: await r2Summary(context.env.PHOTOS_BUCKET, ['leads/']),
        documents: await r2Summary(context.env.DOCUMENTS_BUCKET, ['agreements/']),
      },
      backup: {
        recentRuns: backupRuns.results ?? [],
        openIncidents: incidents.results ?? [],
      },
      retention: {
        policies: retention.results ?? [],
        holds: holds.results ?? [],
      },
      settings: settings.results ?? [],
      note:
        'Provider free-tier usage and R2 byte totals require Cloudflare account analytics. Counts above are sampled/D1-derived; no universal capacity percentage is invented. A backup run record is not restore proof. The retention registry records intent only; it does not delete records.',
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
    // A single photo deletion is a routine owner action inside an authenticated
    // session. Bulk cleanup, exports and retention/legal-hold changes remain
    // step-up protected.
    if (['photo_cleanup', 'save_retention_policy', 'create_legal_hold', 'release_legal_hold'].includes(action)) {
      requireStepUp(actor);
    }
    if (action === 'photo_delete') {
      const key = text(body.key, 300);
      if (!isPhotoKey(key)) return json({ ok: false, error: 'photo_key_invalid' }, 400);
      const ref = photoRef(key);
      if (!context.env.PHOTOS_BUCKET) return json({ ok: false, error: 'photo_storage_not_configured' }, 503);
      const owners = await photoOwners(db, [ref]);
      const held = await activeHoldSubjects(db);
      if (refProtected(ref, owners.get(ref), held)) {
        return json({ ok: false, error: 'legal_hold_active' }, 409);
      }
      await context.env.PHOTOS_BUCKET?.delete([key, `${key}.meta.json`]);
      await audit(db, {
        actorUserId: actor.id,
        action: 'storage.photo_deleted',
        entityType: 'photo',
        entityId: ref || 'unlinked',
        detail: key.split('/').pop()?.split('-')[0] ?? '',
      });
      return json({ ok: true });
    }
    if (action === 'photo_cleanup') {
      const dryRun = body.dryRun !== false;
      const result = await cleanupPhotos(
        db,
        context.env.PHOTOS_BUCKET,
        Math.min(365, Math.max(1, Number(body.days) || 30)),
        dryRun,
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
        detail: `eligible=${result.eligible};protected=${result.protectedEligible};deleted=${result.deleted}`,
      });
      return json({ ok: true, ...result });
    }
    if (action === 'save_retention_policy') {
      const recordType = text(body.recordType, 80).toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
      if (!recordType) return json({ ok: false, error: 'record_type_required' }, 400);
      const retentionMonths = Math.max(0, Math.min(600, Math.round(Number(body.retentionMonths) || 0)));
      const status = ['draft', 'active', 'retired'].includes(String(body.status)) ? String(body.status) : 'draft';
      const id = `rpol_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO retention_policies
           (id, record_type, description, retention_months, automatic_cleanup, status,
            approved_by_admin_user_id, approved_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(record_type) DO UPDATE SET
             description = excluded.description,
             retention_months = excluded.retention_months,
             automatic_cleanup = excluded.automatic_cleanup,
             status = excluded.status,
             approved_by_admin_user_id = excluded.approved_by_admin_user_id,
             approved_at = excluded.approved_at,
             updated_at = excluded.updated_at`,
        )
        .bind(
          id,
          recordType,
          text(body.description, 1000),
          retentionMonths,
          body.automaticCleanup === true ? 1 : 0,
          status,
          status === 'active' ? actor.id : null,
          status === 'active' ? new Date().toISOString() : null,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'retention.policy_saved',
        entityType: 'retention_policy',
        entityId: recordType,
        detail: `${retentionMonths}:${status}`,
      });
      return json({ ok: true });
    }
    if (action === 'create_legal_hold') {
      const subjectType = text(body.subjectType, 60);
      const subjectId = text(body.subjectId, 120);
      const reason = text(body.reason, 1000);
      if (!subjectType || !subjectId || reason.length < 5) {
        return json({ ok: false, error: 'legal_hold_fields_required' }, 400);
      }
      const id = `hold_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO legal_holds
           (id, subject_type, subject_id, reason, status, created_by_admin_user_id, created_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .bind(id, subjectType, subjectId, reason, actor.id, new Date().toISOString())
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'retention.legal_hold_created',
        entityType: subjectType,
        entityId: subjectId,
        detail: reason.slice(0, 200),
      });
      return json({ ok: true, id });
    }
    if (action === 'release_legal_hold') {
      const holdId = text(body.holdId, 120);
      if (!holdId) return json({ ok: false, error: 'legal_hold_required' }, 400);
      await db
        .prepare(
          "UPDATE legal_holds SET status = 'released', released_by_admin_user_id = ?, released_at = ? WHERE id = ? AND status = 'active'",
        )
        .bind(actor.id, new Date().toISOString(), holdId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'retention.legal_hold_released',
        entityType: 'legal_hold',
        entityId: holdId,
      });
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'storage_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
