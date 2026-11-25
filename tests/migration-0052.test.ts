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

test('migration 0052 is additive and preserves existing customers and signing history', () => {
  const migration = fs.readFileSync('migrations/0052_signing_customer_fields.sql', 'utf8');
  assert.match(migration, /ALTER TABLE signing_requests ADD COLUMN customer_fields_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.doesNotMatch(migration, /\b(DROP|DELETE|TRUNCATE)\b/i);

  const db = migratedTo('0051_legal_collections.sql');
  const columnsBefore = db.prepare('PRAGMA table_info(signing_requests)').all().map((row) => row.name);
  assert.equal(columnsBefore.includes('customer_fields_json'), false);

  db.prepare("INSERT INTO branches (id, name, state, status) VALUES ('branch_test', 'Test', 'FL', 'active')").run();
  db.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_test', 'branch_test', 'Existing', 'Customer', 'active')").run();
  db.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_test', 'cust_test', 'branch_test', 'Home', '1 Existing Way', 'Pensacola', 'FL', '32502', 'active')").run();
  db.prepare(
    `INSERT INTO document_templates
     (id, title, category, version, status, source_kind, content_text, content_sha256, signer_party)
     VALUES ('doc_test', 'Existing Agreement', 'residential', '1.0', 'approved', 'text', 'Existing approved text.', 'hash-test', 'customer')`,
  ).run();
  db.prepare(
    `INSERT INTO document_bundles
     (id, code, name, description, service_category, subject_type, status, version, purpose, packet_type, instructions, is_system)
     VALUES ('bundle_test', 'customer.residential', 'Existing Packet', '', 'residential', 'customer', 'active', 1, 'customer', 'residential_one_time', '', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO document_bundle_items
     (bundle_id, template_id, sort_order, required, enforcement_stage, condition_key, condition_value, per_booking)
     VALUES ('bundle_test', 'doc_test', 0, 1, 'before_payment', '', '', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO signing_requests
     (id, bundle_id, bundle_code, bundle_version, subject_type, customer_id, property_id,
      booking_reference, service_code, status, requirement_snapshot_json, token_hash,
      token_expires_at, executed_copy_text, executed_sha256, executed_at, packet_name)
     VALUES ('signreq_existing', 'bundle_test', 'customer.residential', 1, 'customer', 'cust_test', 'prop_test',
      'SS-EXISTING-1', 'residential-cleaning', 'signed', '[]', 'token-hash-existing',
      '2026-12-01T00:00:00.000Z', 'EXISTING EXECUTED COPY', 'existing-hash', '2026-11-22T00:00:00.000Z', 'Existing Packet')`,
  ).run();
  db.prepare(
    `INSERT INTO document_signatures
     (id, signing_request_id, template_id, template_version, document_sha256, signed_content_text,
      signer_party, signer_name, signer_email, signature_json, consent_version, signed_at, status, attempt)
     VALUES ('sig_existing', 'signreq_existing', 'doc_test', '1.0', 'hash-test', 'Existing approved text.',
      'customer', 'Existing Customer', 'existing@example.test', '{"type":"typed","value":"Existing Customer"}',
      '2026-11-01.esign-consent.v1', '2026-11-22T00:00:00.000Z', 'signed', 1)`,
  ).run();

  const countsBefore = {
    customers: Number(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n),
    properties: Number(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n),
    requests: Number(db.prepare('SELECT COUNT(*) AS n FROM signing_requests').get().n),
    signatures: Number(db.prepare('SELECT COUNT(*) AS n FROM document_signatures').get().n),
    bundles: Number(db.prepare('SELECT COUNT(*) AS n FROM document_bundles').get().n),
    items: Number(db.prepare('SELECT COUNT(*) AS n FROM document_bundle_items').get().n),
  };
  const beforeCopy = db.prepare("SELECT executed_copy_text, executed_sha256 FROM signing_requests WHERE id = 'signreq_existing'").get();

  db.exec(migration);

  const countsAfter = {
    customers: Number(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n),
    properties: Number(db.prepare('SELECT COUNT(*) AS n FROM properties').get().n),
    requests: Number(db.prepare('SELECT COUNT(*) AS n FROM signing_requests').get().n),
    signatures: Number(db.prepare('SELECT COUNT(*) AS n FROM document_signatures').get().n),
    bundles: Number(db.prepare('SELECT COUNT(*) AS n FROM document_bundles').get().n),
    items: Number(db.prepare('SELECT COUNT(*) AS n FROM document_bundle_items').get().n),
  };
  assert.deepEqual(countsAfter, countsBefore);

  const columnsAfter = db.prepare('PRAGMA table_info(signing_requests)').all();
  const fieldColumn = columnsAfter.find((row) => row.name === 'customer_fields_json');
  assert.ok(fieldColumn);
  assert.equal(fieldColumn.dflt_value, "'{}'");
  assert.equal(fieldColumn.notnull, 1);

  const existing = db.prepare("SELECT customer_fields_json, executed_copy_text, executed_sha256 FROM signing_requests WHERE id = 'signreq_existing'").get();
  assert.equal(existing.customer_fields_json, '{}');
  assert.equal(existing.executed_copy_text, beforeCopy.executed_copy_text);
  assert.equal(existing.executed_sha256, beforeCopy.executed_sha256);

  const signature = db.prepare("SELECT signer_name, signature_json, status FROM document_signatures WHERE id = 'sig_existing'").get();
  assert.equal(signature.signer_name, 'Existing Customer');
  assert.match(signature.signature_json, /Existing Customer/);
  assert.equal(signature.status, 'signed');

  db.prepare("UPDATE signing_requests SET customer_fields_json = ? WHERE id = 'signreq_existing'").run(
    JSON.stringify({ access_method: 'customer_present' }),
  );
  assert.match(
    String(db.prepare("SELECT customer_fields_json FROM signing_requests WHERE id = 'signreq_existing'").get().customer_fields_json),
    /customer_present/,
  );

  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_signing_requests_customer_fields'").all().length, 1);
  const integrity = db.prepare('PRAGMA integrity_check').all();
  assert.equal(integrity.length, 1);
  assert.equal(integrity[0]?.integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});
