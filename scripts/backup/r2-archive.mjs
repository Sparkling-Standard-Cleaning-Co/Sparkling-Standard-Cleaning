#!/usr/bin/env node
// Download every object in a private R2 bucket/prefix into a local staging
// directory so it can be included in an encrypted backup archive.
//
// Usage: node scripts/backup/r2-archive.mjs --out <directory> [--prefix <prefix>]

import path from 'node:path';
import { downloadPrefix, requireR2Config } from './lib/r2.mjs';

function argValue(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

async function main() {
  const outDir = argValue('--out');
  if (!outDir) throw new Error('Usage: node scripts/backup/r2-archive.mjs --out <directory> [--prefix <prefix>]');
  const config = requireR2Config();
  const downloaded = await downloadPrefix(config, argValue('--prefix'), path.resolve(outDir));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    bucket: config.bucket,
    prefix: argValue('--prefix'),
    outDir: path.resolve(outDir),
    objects: downloaded.length,
    bytes: downloaded.reduce((total, object) => total + object.size, 0),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`r2 archive failed: ${error.message}\n`);
  process.exitCode = 1;
});
