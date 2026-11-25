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

test('migration 0054 is additive and adds operational alert and test-request state', () => {
  const migration = fs.readFileSync('migrations/0054_admin_operations.sql', 'utf8');
  assert.match(migration, /ALTER TABLE quick_estimates ADD COLUMN estimate_number/);
  assert.match(migration, /ALTER TABLE booking_requests ADD COLUMN is_test/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operational_alerts/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM/i);

  const db = migratedTo('0053_signing_pricing_snapshot.sql');
  db.exec(migration);
  const quickColumns = db.prepare('PRAGMA table_info(quick_estimates)').all().map((row) => row.name);
  assert.ok(quickColumns.includes('estimate_number'));
  const requestColumns = db.prepare('PRAGMA table_info(booking_requests)').all().map((row) => row.name);
  assert.ok(requestColumns.includes('is_test'));
  assert.ok(requestColumns.includes('test_marked_at'));
  const alertTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operational_alerts'").all();
  assert.equal(alertTable.length, 1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});
