#!/usr/bin/env node
// Restore an encrypted backup into an isolated directory. This tool never
// overwrites a non-empty directory and never contacts production systems.
//
// Usage: node scripts/backup/restore.mjs <archive> --out <empty-directory>

import fsp from 'node:fs/promises';
import path from 'node:path';
import { decodeKey } from './lib/crypto.mjs';
import { extractEncryptedArchive } from './lib/archive.mjs';

function argValue(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

async function main() {
  const archive = process.argv[2];
  const outDir = argValue('--out');
  if (!archive || archive.startsWith('--') || !outDir) {
    throw new Error('Usage: node scripts/backup/restore.mjs <archive> --out <empty-directory>');
  }
  const target = path.resolve(outDir);
  const existing = await fsp.readdir(target).catch(() => null);
  if (existing && existing.length > 0) {
    throw new Error(`Refusing to restore into a non-empty directory: ${target}`);
  }
  const key = decodeKey(process.env.BACKUP_ENCRYPTION_KEY);
  const result = await extractEncryptedArchive({
    archivePath: path.resolve(archive),
    outDir: target,
    key,
  });
  const report = {
    ok: true,
    archive: path.resolve(archive),
    restoredTo: target,
    fileCount: result.entries.length,
    bytes: result.bytes,
    note: 'Restore is isolated. Do not copy over production D1 or R2 without an approved recovery procedure.',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`restore failed: ${error.message}\n`);
  process.exitCode = 1;
});
