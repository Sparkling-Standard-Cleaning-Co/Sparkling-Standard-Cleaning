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

test('migration 0055 adds branch calendar and review configuration without deleting data', () => {
  const migration = fs.readFileSync('migrations/0055_branch_calendars_reviews.sql', 'utf8');
  assert.match(migration, /ALTER TABLE branches ADD COLUMN calendar_id/);
  assert.match(migration, /ALTER TABLE branches ADD COLUMN review_url/);
  assert.match(migration, /ALTER TABLE branches ADD COLUMN review_requests_enabled/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS review_requests/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM/i);

  const db = migratedTo('0054_admin_operations.sql');
  db.exec(migration);
  const columns = db.prepare('PRAGMA table_info(branches)').all().map((row) => row.name);
  for (const column of [
    'calendar_id',
    'calendar_name',
    'review_url',
    'review_requests_enabled',
    'review_request_delay_hours',
    'review_request_max_per_customer',
  ]) {
    assert.ok(columns.includes(column), `${column} should exist`);
  }
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_requests'").all();
  assert.equal(table.length, 1);
  const pensacola = db
    .prepare("SELECT review_url, review_requests_enabled FROM branches WHERE id = 'branch_pensacola'")
    .get() as { review_url: string; review_requests_enabled: number };
  assert.equal(pensacola.review_url, 'https://g.page/r/CXAcv1Pp7OI2ECE/review');
  assert.equal(pensacola.review_requests_enabled, 0);
  const tampa = db
    .prepare("SELECT review_url, review_requests_enabled FROM branches WHERE id = 'branch_tampa'")
    .get() as { review_url: string; review_requests_enabled: number };
  assert.equal(tampa.review_url, '');
  assert.equal(tampa.review_requests_enabled, 0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});
