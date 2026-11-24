import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function migratedTo(last: string): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
    if (file === last) break;
  }
  return db;
}

test('migration 0058 adds review state and document family archiving without destructive changes', () => {
  const migration = fs.readFileSync('migrations/0058_document_library_review_state.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS document_family_state/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_review_state/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM/i);

  const db = migratedTo('0057_invoice_service_date.sql');
  db.exec(
    `INSERT INTO document_templates (id, title, category, version, status, source_kind, content_text,
       content_sha256, r2_key, signer_party, requires_countersignature, requires_verification)
     VALUES ('doc_preserved', 'Preserved Agreement', 'residential', '1.0', 'approved', 'text', 'Body', 'hash', '', 'customer', 0, 0)`,
  );
  db.exec(
    `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
     VALUES ('cust_preserved', 'branch_pensacola', 'Preserved', 'Customer', 'active', 'website')`,
  );
  db.exec(migration);

  const template = db.prepare("SELECT title, status FROM document_templates WHERE id = 'doc_preserved'").get() as {
    title: string;
    status: string;
  };
  assert.equal(template.title, 'Preserved Agreement');
  assert.equal(template.status, 'approved');
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'cust_preserved'").get() as { n: number }).n,
    1,
  );

  const reviewColumns = db.prepare('PRAGMA table_info(customer_review_state)').all().map((row) => row.name);
  for (const column of [
    'customer_id',
    'branch_id',
    'status',
    'invitation_count',
    'last_invited_at',
    'last_request_id',
    'marked_reviewed_at',
    'marked_by_admin_user_id',
    'source',
    'note',
  ]) {
    assert.ok(reviewColumns.includes(column), `${column} should exist`);
  }
  const familyColumns = db.prepare('PRAGMA table_info(document_family_state)').all().map((row) => row.name);
  for (const column of ['family_key', 'title', 'archived_at', 'archived_by_admin_user_id']) {
    assert.ok(familyColumns.includes(column), `${column} should exist`);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});
