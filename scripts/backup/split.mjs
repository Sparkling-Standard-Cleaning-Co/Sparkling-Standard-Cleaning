#!/usr/bin/env node
// Split an encrypted archive into upload-sized parts without decrypting it.
// The parts can be rejoined and verified with join.mjs before restore.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

function argValue(name, fallback = '') {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

async function main() {
  const archive = process.argv[2];
  const outDir = argValue('--out');
  const sizeMb = Math.max(1, Number(argValue('--size-mb', '250')));
  if (!archive || archive.startsWith('--') || !outDir) {
    throw new Error('Usage: node scripts/backup/split.mjs <archive> --out <directory> [--size-mb 250]');
  }
  const source = path.resolve(archive);
  const totalBytes = (await fsp.stat(source)).size;
  const bytesPerPart = sizeMb * 1024 * 1024;
  await fsp.mkdir(path.resolve(outDir), { recursive: true });
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(source), hash);
  const originalSha256 = hash.digest('hex');
  const handle = await fsp.open(source, 'r');
  const parts = [];
  try {
    let offset = 0;
    let index = 0;
    while (offset < totalBytes) {
      index += 1;
      const length = Math.min(bytesPerPart, totalBytes - offset);
      const buffer = Buffer.alloc(length);
      const read = await handle.read(buffer, 0, length, offset);
      if (read.bytesRead !== length) throw new Error('Short read while splitting the archive.');
      const name = `${path.basename(source)}.part${String(index).padStart(3, '0')}`;
      const target = path.join(path.resolve(outDir), name);
      await fsp.writeFile(target, buffer, { mode: 0o600 });
      const partHash = crypto.createHash('sha256').update(buffer).digest('hex');
      parts.push({ name, bytes: length, sha256: partHash });
      offset += length;
    }
  } finally {
    await handle.close();
  }
  const manifest = {
    format: 'sparkling-standard-backup-parts',
    version: 1,
    createdAt: new Date().toISOString(),
    original: path.basename(source),
    originalBytes: totalBytes,
    originalSha256,
    parts,
  };
  const manifestPath = path.join(path.resolve(outDir), `${path.basename(source)}.parts.json`);
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, manifest: manifestPath, parts: parts.length, originalSha256 }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`split failed: ${error.message}\n`);
  process.exitCode = 1;
});
