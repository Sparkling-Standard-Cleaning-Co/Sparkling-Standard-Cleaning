#!/usr/bin/env node
// Decrypt a backup archive into an isolated temporary directory and prove that
// every file hash, every size and any embedded SQLite/D1 export is usable.
//
// Usage: node scripts/backup/verify.mjs <archive> [--keep]

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeKey } from './lib/crypto.mjs';
import { extractEncryptedArchive } from './lib/archive.mjs';

function flag(name) {
  return process.argv.slice(2).includes(name);
}

async function verifyDatabase(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.sql') {
    const sql = await fsp.readFile(filePath, 'utf8');
    if (!/create\s+table/i.test(sql)) throw new Error(`SQL export has no CREATE TABLE statements: ${filePath}`);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(sql);
      const check = db.prepare('PRAGMA integrity_check').get();
      const tables = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get();
      return { kind: 'd1-sql', integrity: String(check?.integrity_check ?? check ?? 'unknown'), tables: Number(tables?.count ?? 0) };
    } finally {
      db.close();
    }
  }
  if (['.db', '.sqlite', '.sqlite3'].includes(extension)) {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      const check = db.prepare('PRAGMA integrity_check').get();
      const tables = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get();
      return { kind: 'sqlite', integrity: String(check?.integrity_check ?? check ?? 'unknown'), tables: Number(tables?.count ?? 0) };
    } finally {
      db.close();
    }
  }
  return null;
}

async function main() {
  const archive = process.argv[2];
  if (!archive || archive.startsWith('--')) throw new Error('Usage: node scripts/backup/verify.mjs <archive> [--keep]');
  const key = decodeKey(process.env.BACKUP_ENCRYPTION_KEY);
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sparkling-backup-verify-'));
  const outDir = path.join(temp, 'restore');
  try {
    const result = await extractEncryptedArchive({
      archivePath: path.resolve(archive),
      outDir,
      key,
    });
    const databases = [];
    for (const entry of result.entries) {
      const database = await verifyDatabase(path.join(outDir, entry.path));
      if (database) databases.push({ path: entry.path, ...database });
    }
    const bad = databases.filter((entry) => entry.integrity !== 'ok');
    if (bad.length > 0) throw new Error(`Database integrity check failed: ${bad.map((entry) => entry.path).join(', ')}`);
    const report = {
      ok: true,
      archive: path.resolve(archive),
      fileCount: result.entries.length,
      bytes: result.bytes,
      databases,
      extractedTo: flag('--keep') ? outDir : null,
    };
    if (!flag('--keep')) {
      await fsp.rm(temp, { recursive: true, force: true });
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
