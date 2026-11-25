#!/usr/bin/env node
// Write non-secret backup metadata for an encrypted recovery point.
// Usage: node scripts/backup/metadata.mjs --out <directory> --d1 <export.sql> [--profile daily]

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return '';
  }
}

async function main() {
  const out = path.resolve(arg('--out'));
  const d1 = arg('--d1');
  if (!out) throw new Error('Usage: node scripts/backup/metadata.mjs --out <directory> --d1 <export.sql> [--profile daily]');
  await fsp.mkdir(out, { recursive: true });
  let database = null;
  if (d1) {
    const filePath = path.resolve(d1);
    const bytes = await fsp.readFile(filePath);
    database = {
      name: path.basename(filePath),
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const metadata = {
    format: 'sparkling-standard-backup-metadata',
    version: 1,
    createdAt: new Date().toISOString(),
    profile: arg('--profile', 'daily'),
    repository: {
      branch: git(['branch', '--show-current']),
      commit: git(['rev-parse', 'HEAD']),
    },
    database,
    publicSite: process.env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com',
    note: 'This metadata is encrypted inside the backup archive. It contains no customer records or credentials.',
  };
  const target = path.join(out, 'backup-metadata.json');
  await fsp.writeFile(target, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, metadata: target, profile: metadata.profile }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`metadata failed: ${error.message}\n`);
  process.exitCode = 1;
});
