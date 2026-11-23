import './helpers/enable-signing.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner } from '../src/lib/admin/operations.ts';
import {
  activeRequirements,
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  createTemplateRevision,
  publishTemplateRevision,
  signSigningRequest,
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

test('an approved revision is versioned, moved into packets and leaves prior signatures intact', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-revision@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const customerId = `cust_${crypto.randomUUID()}`;
  const propertyId = `prop_${crypto.randomUUID()}`;
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Jordan', 'Example', 'active')").run(customerId);
  db.raw.prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES ('ct_revision', ?, 'email', 'jordan.revision@example.test', 'jordan.revision@example.test', 1)").run(customerId);
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES (?, ?, 'branch_pensacola', 'Home', '100 Revision Street', 'Pensacola', 'FL', '32502', 'active')").run(propertyId, customerId);

  const original = await createTemplate(db, owner.id, {
    title: 'Residential Revision Agreement',
    category: 'residential',
    version: '2026-11-22.remediation.v1',
    contentText: [
      'SPARKLING STANDARD CLEANING CO.',
      'Residential Revision Agreement',
      'Standards That Sparkle.',
      'Document LEG-REVISION  |  Version 2026-11-22.remediation.v1',
      '',
      '1. Scope',
      '1.1 The approved scope is preserved.',
    ].join('\n'),
    familyKey: 'revision-agreement',
  });
  await approveTemplate(db, owner.id, original.id);
  const bundle = await createBundle(db, owner.id, {
    code: 'customer.residential', name: 'Revision Test Packet', subjectType: 'customer', serviceCategory: 'residential',
  });
  await addBundleItem(db, owner.id, {
    bundleId: bundle.id, templateId: original.id, required: true, enforcementStage: 'before_payment',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId,
    propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: 'SS-REVISION-1',
  };
  const request = await createSigningRequest(db, context, { createdByAdminUserId: owner.id });
  assert.equal(request.required, true);
  await signSigningRequest(db, request.token!, {
    signerName: 'Jordan Example',
    signerEmail: 'jordan.revision@example.test',
    consent: true,
    signatures: { [original.id]: { value: 'Jordan Example', type: 'typed' } },
    customerFields: { access_method: 'customer_present' },
    request: new Request('https://example.test/api/document-sign', { method: 'POST' }),
  });
  const signedBefore = db.raw
    .prepare('SELECT signed_content_text FROM document_signatures WHERE signing_request_id = ?')
    .get(String(request.requestId)) as { signed_content_text: string };
  // Simulate the historical production state: the approved template text
  // itself contains the internal notice that predates the guard.
  db.raw
    .prepare('UPDATE document_templates SET content_text = ? WHERE id = ?')
    .run(
      [
        'SPARKLING STANDARD CLEANING CO.',
        'Residential Revision Agreement',
        'Standards That Sparkle.',
        'Document LEG-REVISION  |  Version 2026-11-22.remediation.v1',
        'OWNER REVIEW DRAFT — NOT EFFECTIVE UNTIL APPROVED',
        '',
        '1. Scope',
        '1.1 The approved scope is preserved.',
      ].join('\n'),
      original.id,
    );

  const revision = await createTemplateRevision(db, owner.id, original.id, {
    version: '2026-11-23.customer-release.v1',
  });
  assert.equal(revision.removed.length, 1);
  assert.match(revision.contentText, /Version 2026-11-23\.customer-release\.v1/);
  assert.doesNotMatch(revision.contentText, /OWNER REVIEW DRAFT|not effective until approved/i);
  assert.match(revision.contentText, /1\.1 The approved scope is preserved/);

  const published = await publishTemplateRevision(db, owner.id, revision.id);
  assert.equal(published.previousTemplateId, original.id);
  assert.equal(published.updatedPackets, 1);
  assert.equal(published.affectedCustomers, 1);

  const old = db.raw.prepare('SELECT status FROM document_templates WHERE id = ?').get(original.id) as { status: string };
  const next = db.raw.prepare('SELECT status, version, supersedes_template_id FROM document_templates WHERE id = ?').get(revision.id) as { status: string; version: string; supersedes_template_id: string };
  assert.equal(old.status, 'retired');
  assert.equal(next.status, 'approved');
  assert.equal(next.version, '2026-11-23.customer-release.v1');
  assert.equal(next.supersedes_template_id, original.id);

  const item = db.raw.prepare('SELECT template_id FROM document_bundle_items WHERE bundle_id = ?').get(bundle.id) as { template_id: string };
  assert.equal(item.template_id, revision.id);
  const active = await activeRequirements(db, context);
  assert.equal(active.requirements[0]?.templateId, revision.id);

  const signature = db.raw.prepare('SELECT template_id, signed_content_text FROM document_signatures WHERE signing_request_id = ?').get(String(request.requestId)) as { template_id: string; signed_content_text: string };
  assert.equal(signature.template_id, original.id);
  assert.equal(signature.signed_content_text, signedBefore.signed_content_text);
  assert.doesNotMatch(signature.signed_content_text, /OWNER REVIEW DRAFT/);
});

test('approval and publishing reject internal draft notices', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-revision-guard@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const draft = await createTemplate(db, owner.id, {
    title: 'Draft Guard Agreement',
    category: 'residential',
    version: '1.0',
    contentText: 'Title\n\nOWNER REVIEW DRAFT — NOT EFFECTIVE UNTIL APPROVED\n\n1.1 Clause text.',
  });
  await assert.rejects(
    () => approveTemplate(db, owner.id, draft.id),
    /document_internal_notice/,
  );

  const source = await createTemplate(db, owner.id, {
    title: 'Publish Guard Agreement',
    category: 'residential',
    version: '1.0',
    contentText: 'Title\n\n1.1 Clause text.',
  });
  db.raw.prepare("UPDATE document_templates SET status='approved' WHERE id=?").run(source.id);
  const revision = await createTemplate(db, owner.id, {
    title: 'Publish Guard Agreement',
    category: 'residential',
    version: '2.0',
    contentText: 'Title\n\nOWNER REVIEW DRAFT — NOT EFFECTIVE UNTIL APPROVED\n\n1.1 Clause text.',
    supersedesTemplateId: source.id,
  });
  await assert.rejects(
    () => publishTemplateRevision(db, owner.id, revision.id),
    /document_internal_notice/,
  );
});
