#!/usr/bin/env node
// Download one encrypted backup object from the R2 backup bucket for
// independent checksum and restore verification.
//
// Usage: node scripts/backup/r2-download.mjs --key <object-key> --out <file>

import { getToFile, requireR2Config } from './lib/r2.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : '';
}

async function main() {
  const key = arg('--key');
  const out = arg('--out');
  if (!key || !out) throw new Error('Usage: node scripts/backup/r2-download.mjs --key <object-key> --out <file>');
  const config = requireR2Config();
  const result = await getToFile(config, key, out);
  process.stdout.write(`${JSON.stringify({ ok: true, bucket: config.bucket, ...result }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`R2 download failed: ${error.message}\n`);
  process.exitCode = 1;
});
