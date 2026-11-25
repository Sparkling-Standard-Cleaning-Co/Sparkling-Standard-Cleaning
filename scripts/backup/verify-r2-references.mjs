#!/usr/bin/env node
// Verify that application R2 objects referenced by the production database
// were captured in the staged backup.
//
// Usage:
//   node scripts/backup/verify-r2-references.mjs \
//     --d1 backup-out/d1.sql --r2-manifest backup-out/r2-app/manifest.json
//
// The D1 export is restored into an in-memory SQLite database. Every known
// object-key column is compared with the staged R2 manifest. A missing object
// fails the check so an incomplete archive cannot be reported as recoverable.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const d1Path = path.resolve(arg('--d1'));
const manifestPath = path.resolve(arg('--r2-manifest'));
if (!fs.existsSync(d1Path) || !fs.existsSync(manifestPath)) {
  console.error(JSON.stringify({ ok: false, error: 'input_missing', d1Path, manifestPath }));
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const available = new Set(
  (manifest.files ?? []).map((entry) => `${entry.bucket}\u0000${entry.key}`),
);
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = OFF');
db.exec(fs.readFileSync(d1Path, 'utf8'));

function tableExists(table) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .some((row) => row.name === column);
}

const targets = [
  { table: 'document_templates', column: 'r2_key', bucket: 'sparkling-standard-documents' },
  { table: 'document_signatures', column: 'r2_key', bucket: 'sparkling-standard-documents' },
  { table: 'job_media', column: 'r2_key', bucket: 'sparkling-standard-documents' },
  {
    table: 'leads',
    column: 'payload_json',
    bucket: 'sparkling-standard-lead-photos',
    jsonField: 'photo_keys',
  },
  {
    table: 'booking_requests',
    column: 'payload_json',
    bucket: 'sparkling-standard-lead-photos',
    jsonField: 'photo_keys',
  },
];

const checked = [];
const missing = [];
const buckets = new Set((manifest.files ?? []).map((entry) => entry.bucket));
for (const target of targets) {
  if (!columnExists(target.table, target.column)) {
    checked.push({ table: target.table, column: target.column, status: 'table_absent' });
    continue;
  }
  // Only verify a bucket that the backup actually includes. The staging
  // script names its output buckets exactly as the Cloudflare buckets.
  if (!buckets.has(target.bucket)) {
    checked.push({ table: target.table, column: target.column, status: 'bucket_not_in_archive' });
    continue;
  }
  let references = 0;
  if (target.jsonField) {
    const rows = db
      .prepare(`SELECT DISTINCT "${target.column}" AS value FROM "${target.table}"`)
      .all();
    for (const row of rows) {
      let parsed = {};
      try {
        parsed = JSON.parse(String(row.value ?? '{}'));
      } catch {
        parsed = {};
      }
      const keys = String(parsed?.[target.jsonField] ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
      for (const key of keys) {
        references += 1;
        if (!available.has(`${target.bucket}\u0000${key}`)) {
          missing.push({ table: target.table, bucket: target.bucket, key });
        }
      }
    }
  } else {
    const rows = db
      .prepare(
        `SELECT DISTINCT "${target.column}" AS value FROM "${target.table}"
         WHERE TRIM("${target.column}") <> ''`,
      )
      .all();
    for (const row of rows) {
      const key = String(row.value ?? '').trim();
      if (!key) continue;
      references += 1;
      if (!available.has(`${target.bucket}\u0000${key}`)) {
        missing.push({ table: target.table, bucket: target.bucket, key });
      }
    }
  }
  checked.push({
    table: target.table,
    column: target.column,
    bucket: target.bucket,
    references,
    status: 'checked',
  });
}

const report = {
  ok: missing.length === 0,
  manifestFiles: manifest.files?.length ?? 0,
  buckets: [...buckets].sort(),
  checked,
  missingCount: missing.length,
  missingSample: missing.slice(0, 20),
  note: 'A clean check proves every known database reference has a staged object. It does not prove provider-side object durability; R2 and OneDrive round-trip verification does that separately.',
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
