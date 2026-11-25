import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner } from '../src/lib/admin/operations.ts';
import {
  addBundleItem,
  approveTemplate,
  archiveTemplateFamily,
  createBundle,
  createTemplate,
  createTemplateRevision,
  deleteDraftTemplate,
  listTemplateLibrary,
  listTemplates,
  publishTemplateRevision,
  restoreTemplateFamily,
  templateFamilyHistory,
} from '../src/lib/documents/service.ts';

class SqlStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.values as never[])) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[] };
  }
  async run(): Promise<D1Result> {
    this.db.prepare(this.sql).run(...(this.values as never[]));
    return { success: true };
  }
}

class TestD1 implements D1Database {
  readonly raw = new DatabaseSync(':memory:');
  prepare(query: string): D1PreparedStatement { return new SqlStatement(this.raw, query); }
}

function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

test('document library shows one approved entry per family and separates drafts and history', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-library@example.test',
    name: 'Library Owner',
    password: 'SyntheticOwner!2026',
  });
  const access = await createTemplate(db, owner.id, {
    title: 'Residential Access Authorization',
    category: 'residential',
    familyKey: 'access-authorization',
    version: '2026-11-22.customer-release.v1',
    contentText: '<p>Access terms version one.</p>',
  });
  await approveTemplate(db, owner.id, access.id);
  const revision = await createTemplate(db, owner.id, {
    title: 'Residential Access Authorization',
    category: 'residential',
    familyKey: 'access-authorization',
    version: '2026-11-24.revision.3',
    contentText: '<p>Access terms draft revision.</p>',
    supersedesTemplateId: access.id,
  });
  const privacy = await createTemplate(db, owner.id, {
    title: 'Customer Privacy Notice',
    category: 'residential',
    familyKey: 'privacy-notice',
    version: '2026-11-22.customer-release.v1',
    contentText: '<p>Privacy terms.</p>',
  });
  await approveTemplate(db, owner.id, privacy.id);

  const library = await listTemplateLibrary(db);
  assert.equal(library.families.length, 2);
  assert.equal(library.totals.approved, 2);
  assert.equal(library.totals.drafts, 1);
  const accessFamily = library.families.find((family) => family.familyKey === 'access-authorization');
  assert.ok(accessFamily);
  assert.equal(accessFamily.state, 'active');
  assert.equal(accessFamily.approvedTemplateId, access.id);
  assert.equal(accessFamily.draftTemplateId, revision.id);
  assert.equal(accessFamily.draftCount, 1);
  assert.equal(library.drafts.length, 1);
  assert.equal(library.drafts[0]?.id, revision.id);
  assert.equal(library.drafts[0]?.supersedes_version_label, accessFamily.approvedVersionLabel);

  const history = await templateFamilyHistory(db, 'access-authorization');
  assert.equal(history.templates.length, 2);
  assert.equal(history.archivedAt, null);
});

test('archiving a family is blocked while it is used by an active packet', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-archive@example.test',
    name: 'Archive Owner',
    password: 'SyntheticOwner!2026',
  });
  const template = await createTemplate(db, owner.id, {
    title: 'Residential Access Authorization',
    familyKey: 'access-authorization',
    version: '2026-11-23.customer-release.v1',
    contentText: '<p>Access terms.</p>',
  });
  await approveTemplate(db, owner.id, template.id);
  const bundle = await createBundle(db, owner.id, {
    code: 'packet.library.test',
    name: 'Library Test Packet',
    subjectType: 'customer',
  });
  await addBundleItem(db, owner.id, {
    bundleId: bundle.id,
    templateId: template.id,
    required: true,
    enforcementStage: 'before_payment',
  });

  await assert.rejects(
    () => archiveTemplateFamily(db, owner.id, 'access-authorization'),
    /document_family_in_active_packet/,
  );

  await db.raw
    .prepare('DELETE FROM document_bundle_items WHERE bundle_id = ? AND template_id = ?')
    .run(bundle.id, template.id);
  await archiveTemplateFamily(db, owner.id, 'access-authorization');
  let library = await listTemplateLibrary(db);
  assert.equal(library.families.find((family) => family.familyKey === 'access-authorization')?.state, 'archived');
  assert.equal(library.totals.archivedFamilies, 1);

  await restoreTemplateFamily(db, owner.id, 'access-authorization');
  library = await listTemplateLibrary(db);
  assert.equal(library.families.find((family) => family.familyKey === 'access-authorization')?.state, 'active');
});

test('only unreferenced drafts can be permanently deleted', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-drafts@example.test',
    name: 'Draft Owner',
    password: 'SyntheticOwner!2026',
  });
  const source = await createTemplate(db, owner.id, {
    title: 'Deep Cleaning Agreement',
    familyKey: 'deep-cleaning',
    version: '2026-11-23.customer-release.v1',
    contentText: '<p>Approved terms.</p>',
  });
  await approveTemplate(db, owner.id, source.id);
  const draft = await createTemplate(db, owner.id, {
    title: 'Deep Cleaning Agreement',
    familyKey: 'deep-cleaning',
    version: '2026-11-24.revision.3',
    contentText: '<p>Draft terms.</p>',
    supersedesTemplateId: source.id,
  });
  const bundle = await createBundle(db, owner.id, {
    code: 'packet.draft.test',
    name: 'Draft Test Packet',
    subjectType: 'customer',
  });
  await addBundleItem(db, owner.id, {
    bundleId: bundle.id,
    templateId: draft.id,
    required: false,
    enforcementStage: 'optional',
  });

  await assert.rejects(() => deleteDraftTemplate(db, owner.id, draft.id), /draft_in_use/);
  await db.raw
    .prepare('DELETE FROM document_bundle_items WHERE bundle_id = ? AND template_id = ?')
    .run(bundle.id, draft.id);
  await deleteDraftTemplate(db, owner.id, draft.id);
  const remaining = await listTemplates(db);
  assert.equal(remaining.some((row) => row.id === draft.id), false);
  assert.equal(remaining.some((row) => row.id === source.id), true);

  const library = await listTemplateLibrary(db);
  assert.equal(library.families.find((family) => family.familyKey === 'deep-cleaning')?.draftCount, 0);
  assert.equal(library.families.find((family) => family.familyKey === 'deep-cleaning')?.approvedTemplateId, source.id);
});

test('publishing a revision activates it, retires the previous version and moves packet items', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-publish@example.test',
    name: 'Publish Owner',
    password: 'SyntheticOwner!2026',
  });
  const source = await createTemplate(db, owner.id, {
    title: 'Recurring Residential Agreement',
    familyKey: 'recurring-residential',
    version: '2026-11-23.customer-release.v1',
    contentText: '<p>Original recurring terms.</p>',
  });
  await approveTemplate(db, owner.id, source.id);
  const bundle = await createBundle(db, owner.id, {
    code: 'packet.publish.test',
    name: 'Publish Test Packet',
    subjectType: 'customer',
  });
  await addBundleItem(db, owner.id, {
    bundleId: bundle.id,
    templateId: source.id,
    required: true,
    enforcementStage: 'before_payment',
  });
  const revision = await createTemplateRevision(db, owner.id, source.id, {
    version: '2026-11-24.revision.4',
  });
  const published = await publishTemplateRevision(db, owner.id, revision.id);
  assert.equal(published.previousTemplateId, source.id);
  assert.equal(published.updatedPackets, 1);

  const rows = await listTemplates(db);
  assert.equal(rows.find((row) => row.id === source.id)?.status, 'retired');
  assert.equal(rows.find((row) => row.id === revision.id)?.status, 'approved');
  const item = await db.raw
    .prepare('SELECT template_id FROM document_bundle_items WHERE bundle_id = ?')
    .get(bundle.id) as { template_id: string };
  assert.equal(item.template_id, revision.id);
  const library = await listTemplateLibrary(db);
  const family = library.families.find((entry) => entry.familyKey === 'recurring-residential');
  assert.equal(family?.approvedTemplateId, revision.id);
  assert.equal(family?.retiredCount, 1);
  assert.equal(family?.draftCount, 0);
});
