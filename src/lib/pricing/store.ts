// Versioned pricing store (Cloudflare D1).
//
// Drafts are editable; published versions are immutable snapshots. Publishing
// archives the previous published version and activates the new one in one D1
// batch. Rollback appends a new version from the selected historical snapshot,
// so the version history is never rewritten.

import type { D1Database, D1PreparedStatement } from '../admin/d1.ts';
import {
  normalizePricingSnapshot,
  pricingSnapshotVersion,
  type PricingSnapshot,
  type PricingSnapshotMeta,
} from './snapshot.ts';
import { PRICING_CALCULATION_SCHEMA_VERSION } from '../../config/estimators/calculation-schema.ts';

export interface PricingVersionRecord extends PricingSnapshotMeta {
  snapshot: PricingSnapshot;
  schemaVersion: string;
  configJson: string;
}

export interface PricingVersionSummary extends PricingSnapshotMeta {
  schemaVersion: string;
  changedValues: number | null;
}

export type PricingActor = { id: string; email: string };

export class PricingStoreError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

interface PricingRow {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  config_json: string;
  fingerprint: string;
  schema_version: string;
  based_on_version: number | null;
  note: string;
  created_by: string;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
  published_by: string | null;
  published_by_email: string | null;
  published_at: string | null;
}

const COLUMNS = `id, version, status, config_json, fingerprint, schema_version, based_on_version,
  note, created_by, created_by_email, created_at, updated_at,
  published_by, published_by_email, published_at`;

function nowIso(): string {
  return new Date().toISOString();
}
function rowToRecord(row: PricingRow): PricingVersionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.config_json);
  } catch {
    throw new PricingStoreError('pricing_snapshot_corrupt', 500);
  }
  const normalized = normalizePricingSnapshot(parsed);
  if (!normalized.ok) {
    throw new PricingStoreError('pricing_snapshot_invalid', 500, normalized.errors.join(' '));
  }
  return {
    id: row.id,
    version: Number(row.version),
    status: row.status,
    fingerprint: row.fingerprint,
    note: row.note,
    basedOnVersion: row.based_on_version === null ? null : Number(row.based_on_version),
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    publishedByEmail: row.published_by_email,
    schemaVersion: row.schema_version,
    configJson: row.config_json,
    snapshot: normalized.snapshot,
  };
}

export async function getPricingVersion(db: D1Database, id: string): Promise<PricingVersionRecord | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM pricing_versions WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<PricingRow>();
  return row ? rowToRecord(row) : null;
}

export async function getPublishedPricing(db: D1Database): Promise<PricingVersionRecord | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM pricing_versions WHERE status = 'published' ORDER BY version DESC LIMIT 1`)
    .first<PricingRow>();
  return row ? rowToRecord(row) : null;
}

export async function getLatestDraft(db: D1Database): Promise<PricingVersionRecord | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM pricing_versions WHERE status = 'draft' ORDER BY version DESC LIMIT 1`)
    .first<PricingRow>();
  return row ? rowToRecord(row) : null;
}

export async function listPricingVersions(db: D1Database, limit = 40): Promise<PricingVersionSummary[]> {
  const capped = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await db
    .prepare(
      `SELECT ${COLUMNS} FROM pricing_versions ORDER BY version DESC LIMIT ?`,
    )
    .bind(capped)
    .all<PricingRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    version: Number(row.version),
    status: row.status,
    fingerprint: row.fingerprint,
    note: row.note,
    basedOnVersion: row.based_on_version === null ? null : Number(row.based_on_version),
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    publishedByEmail: row.published_by_email,
    schemaVersion: row.schema_version,
    changedValues: null,
  }));
}

async function nextVersion(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM pricing_versions')
    .first<{ version: number }>();
  return Number(row?.version ?? 0) + 1;
}

function snapshotColumns(
  snapshot: PricingSnapshot,
  actor: PricingActor,
  note: string,
  basedOnVersion: number | null,
): Record<string, unknown> {
  const normalized = normalizePricingSnapshot(snapshot, { strict: true });
  if (!normalized.ok) {
    throw new PricingStoreError('pricing_validation_failed', 400, normalized.errors.join(' '));
  }
  const configJson = JSON.stringify(normalized.snapshot);
  return {
    config_json: configJson,
    fingerprint: pricingSnapshotVersion(normalized.snapshot),
    schema_version: PRICING_CALCULATION_SCHEMA_VERSION,
    based_on_version: basedOnVersion,
    note: note.slice(0, 500),
    created_by: actor.id,
    created_by_email: actor.email,
  };
}

export async function createPricingDraft(
  db: D1Database,
  input: { snapshot?: PricingSnapshot; note?: string; actor: PricingActor },
): Promise<PricingVersionRecord> {
  const published = await getPublishedPricing(db);
  const basedOn = input.snapshot ?? published?.snapshot ?? normalizePricingSnapshot({}).snapshot;
  const columns = snapshotColumns(basedOn, input.actor, input.note ?? '', published?.version ?? null);
  const version = await nextVersion(db);
  const id = `pricing_${crypto.randomUUID()}`;
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO pricing_versions
       (id, version, status, config_json, fingerprint, schema_version, based_on_version, note,
        created_by, created_by_email, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      version,
      columns.config_json,
      columns.fingerprint,
      columns.schema_version,
      columns.based_on_version,
      columns.note,
      columns.created_by,
      columns.created_by_email,
      timestamp,
      timestamp,
    )
    .run();
  const created = await getPricingVersion(db, id);
  if (!created) throw new PricingStoreError('pricing_draft_failed', 500);
  return created;
}

export async function updatePricingDraft(
  db: D1Database,
  input: {
    id: string;
    snapshot: PricingSnapshot;
    note?: string;
    expectedUpdatedAt?: string;
    actor: PricingActor;
  },
): Promise<PricingVersionRecord> {
  const existing = await getPricingVersion(db, input.id);
  if (!existing) throw new PricingStoreError('pricing_draft_not_found', 404);
  if (existing.status !== 'draft') throw new PricingStoreError('pricing_version_not_editable', 409);
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
    throw new PricingStoreError('pricing_draft_conflict', 409);
  }
  const columns = snapshotColumns(input.snapshot, input.actor, input.note ?? existing.note, existing.basedOnVersion);
  const timestamp = nowIso();
  await db
    .prepare(
      `UPDATE pricing_versions
       SET config_json = ?, fingerprint = ?, schema_version = ?, note = ?, updated_at = ?
       WHERE id = ? AND status = 'draft' AND updated_at = ?`,
    )
    .bind(
      columns.config_json,
      columns.fingerprint,
      columns.schema_version,
      columns.note,
      timestamp,
      input.id,
      existing.updatedAt,
    )
    .run();
  const updated = await getPricingVersion(db, input.id);
  if (!updated || updated.updatedAt === existing.updatedAt) {
    throw new PricingStoreError('pricing_draft_conflict', 409);
  }
  return updated;
}

async function runBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) {
    const result = await statement.run();
    if (!result.success) throw new PricingStoreError('pricing_store_failed', 500);
  }
}

export async function publishPricingVersion(
  db: D1Database,
  input: { id: string; note?: string; expectedUpdatedAt?: string; actor: PricingActor },
): Promise<PricingVersionRecord> {
  const version = await getPricingVersion(db, input.id);
  if (!version) throw new PricingStoreError('pricing_version_not_found', 404);
  if (version.status !== 'draft') throw new PricingStoreError('pricing_version_not_draft', 409);
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== version.updatedAt) {
    throw new PricingStoreError('pricing_draft_conflict', 409);
  }
  // Revalidate at the publication boundary: the stored draft may predate a
  // later validation rule, and an invalid price must never go live.
  const normalized = normalizePricingSnapshot(version.snapshot, { strict: true });
  if (!normalized.ok) {
    throw new PricingStoreError('pricing_validation_failed', 400, normalized.errors.join(' '));
  }
  const timestamp = nowIso();
  const note = (input.note ?? version.note).slice(0, 500);
  const configJson = JSON.stringify(normalized.snapshot);
  const fingerprint = pricingSnapshotVersion(normalized.snapshot);
  await runBatch(db, [
    db.prepare(`UPDATE pricing_versions SET status = 'archived' WHERE status = 'published'`),
    db
      .prepare(
        `UPDATE pricing_versions
         SET status = 'published', config_json = ?, fingerprint = ?, note = ?,
             updated_at = ?, published_by = ?, published_by_email = ?, published_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .bind(
        configJson,
        fingerprint,
        note,
        timestamp,
        input.actor.id,
        input.actor.email,
        timestamp,
        input.id,
      ),
  ]);
  const published = await getPublishedPricing(db);
  if (!published || published.id !== input.id) {
    throw new PricingStoreError('pricing_publish_conflict', 409);
  }
  return published;
}

/**
 * Restores a historical snapshot as a NEW published version. The old version
 * is never modified, so the audit trail remains complete.
 */
export async function rollbackPricingVersion(
  db: D1Database,
  input: { id: string; note?: string; actor: PricingActor },
): Promise<PricingVersionRecord> {
  const source = await getPricingVersion(db, input.id);
  if (!source) throw new PricingStoreError('pricing_version_not_found', 404);
  if (source.status === 'draft') throw new PricingStoreError('pricing_version_not_published', 409);
  const normalized = normalizePricingSnapshot(source.snapshot, { strict: true });
  if (!normalized.ok) {
    throw new PricingStoreError('pricing_validation_failed', 400, normalized.errors.join(' '));
  }
  const version = await nextVersion(db);
  const id = `pricing_${crypto.randomUUID()}`;
  const timestamp = nowIso();
  const note = (input.note ?? `Restored from version ${source.version}`).slice(0, 500);
  const configJson = JSON.stringify(normalized.snapshot);
  const fingerprint = pricingSnapshotVersion(normalized.snapshot);
  await runBatch(db, [
    db.prepare(`UPDATE pricing_versions SET status = 'archived' WHERE status = 'published'`),
    db
      .prepare(
        `INSERT INTO pricing_versions
         (id, version, status, config_json, fingerprint, schema_version, based_on_version, note,
          created_by, created_by_email, created_at, updated_at,
          published_by, published_by_email, published_at)
         VALUES (?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        version,
        configJson,
        fingerprint,
        PRICING_CALCULATION_SCHEMA_VERSION,
        source.version,
        note,
        input.actor.id,
        input.actor.email,
        timestamp,
        timestamp,
        input.actor.id,
        input.actor.email,
        timestamp,
      ),
  ]);
  const created = await getPricingVersion(db, id);
  if (!created) throw new PricingStoreError('pricing_rollback_failed', 500);
  return created;
}

export async function discardPricingDraft(
  db: D1Database,
  input: { id: string; actor: PricingActor },
): Promise<void> {
  const existing = await getPricingVersion(db, input.id);
  if (!existing) throw new PricingStoreError('pricing_draft_not_found', 404);
  if (existing.status !== 'draft') throw new PricingStoreError('pricing_version_not_draft', 409);
  await db.prepare(`DELETE FROM pricing_versions WHERE id = ? AND status = 'draft'`).bind(input.id).run();
}

/** Stable JSON string used in audit records without leaking anything private. */
export function pricingAuditDetail(version: PricingVersionRecord): string {
  return JSON.stringify({
    pricingVersionId: version.id,
    pricingVersion: version.version,
    fingerprint: version.fingerprint,
    status: version.status,
  });
}

