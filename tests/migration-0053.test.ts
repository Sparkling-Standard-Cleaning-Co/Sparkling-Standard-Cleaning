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

test('migration 0053 adds a persistent pricing snapshot without touching signed history', () => {
  const migration = fs.readFileSync('migrations/0053_signing_pricing_snapshot.sql', 'utf8');
  assert.match(migration, /ALTER TABLE signing_requests ADD COLUMN pricing_snapshot_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.doesNotMatch(migration, /\b(DROP|DELETE|TRUNCATE)\b/i);

  const db = migratedTo('0052_signing_customer_fields.sql');
  const columnsBefore = db.prepare('PRAGMA table_info(signing_requests)').all().map((row) => row.name);
  assert.equal(columnsBefore.includes('pricing_snapshot_json'), false);
  db.prepare("INSERT INTO branches (id, name, state, status) VALUES ('branch_test', 'Test', 'FL', 'active')").run();
  db.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_test', 'branch_test', 'Existing', 'Customer', 'active')").run();
  db.prepare(
    `INSERT INTO document_bundles
     (id, code, name, description, service_category, subject_type, status, version, purpose, packet_type, instructions, is_system)
     VALUES ('bundle_test', 'customer.deep', 'Existing Packet', '', 'residential', 'customer', 'active', 1, 'customer', 'deep', '', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO signing_requests
     (id, bundle_id, bundle_code, bundle_version, subject_type, customer_id, booking_reference,
      service_code, status, requirement_snapshot_json, token_hash, token_expires_at,
      executed_copy_text, executed_sha256, executed_at, packet_name)
     VALUES ('signreq_existing', 'bundle_test', 'customer.deep', 1, 'customer', 'cust_test',
      'SS-EXISTING-1', 'residential-deep', 'signed', '[]', 'token-hash-existing',
      '2026-12-01T00:00:00.000Z', 'EXISTING EXECUTED COPY', 'existing-hash',
      '2026-11-23T00:00:00.000Z', 'Existing Packet')`,
  ).run();
  const before = db.prepare("SELECT executed_copy_text, executed_sha256 FROM signing_requests WHERE id = 'signreq_existing'").get();

  db.exec(migration);

  const columnsAfter = db.prepare('PRAGMA table_info(signing_requests)').all();
  const column = columnsAfter.find((row) => row.name === 'pricing_snapshot_json');
  assert.ok(column);
  assert.equal(column.notnull, 1);
  assert.equal(column.dflt_value, "'{}'");
  const after = db.prepare("SELECT pricing_snapshot_json, executed_copy_text, executed_sha256 FROM signing_requests WHERE id = 'signreq_existing'").get();
  assert.equal(after.pricing_snapshot_json, '{}');
  assert.equal(after.executed_copy_text, before.executed_copy_text);
  assert.equal(after.executed_sha256, before.executed_sha256);
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_signing_requests_pricing_snapshot'").all().length,
    1,
  );
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});
