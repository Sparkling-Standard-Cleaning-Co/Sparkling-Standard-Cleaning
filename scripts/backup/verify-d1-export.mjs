// Independently verify a D1 SQL export by restoring it into an in-memory
// SQLite database with foreign-key enforcement disabled (D1 exports can list
// tables in creation order where a later-created table is referenced by an
// earlier ALTER TABLE). The verifier then checks migration count, core table
// counts and foreign-key integrity. It never contacts production and never
// writes a database file.
//
// Usage: node scripts/backup/verify-d1-export.mjs <d1-export.sql>

import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/backup/verify-d1-export.mjs <d1-export.sql>');
  process.exit(2);
}
const sql = fs.readFileSync(file, 'utf8');
const digest = crypto.createHash('sha256').update(sql).digest('hex');
const db = new DatabaseSync(':memory:');
try {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(sql);
  const migrations = db.prepare('SELECT COUNT(*) AS count FROM d1_migrations').get();
  const tables = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
  const counts = {};
  for (const table of ['customers', 'properties', 'appointments', 'invoices', 'leads', 'career_applications', 'signing_requests']) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    } catch {
      counts[table] = null;
    }
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  console.log(JSON.stringify({
    ok: violations.length === 0,
    file,
    sha256: digest,
    bytes: Buffer.byteLength(sql),
    migrations: migrations.count,
    tables: tables.count,
    counts,
    foreignKeyViolations: violations.length,
    note: 'Restored into an in-memory SQLite database with foreign-key enforcement disabled. A clean check is restore evidence, not proof that a production D1 import will succeed without the documented procedure.',
  }, null, 2));
  if (violations.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, file, sha256: digest, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  db.close();
}
