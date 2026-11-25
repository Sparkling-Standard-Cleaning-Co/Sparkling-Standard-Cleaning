#!/usr/bin/env node
// Rejoin and verify encrypted archive parts created by split.mjs.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function argValue(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

async function main() {
  const manifestPath = argValue('--manifest');
  const outPath = argValue('--out');
  if (!manifestPath || !outPath) {
    throw new Error('Usage: node scripts/backup/join.mjs --manifest <parts.json> --out <archive>');
  }
  const manifest = JSON.parse(await fsp.readFile(path.resolve(manifestPath), 'utf8'));
  if (manifest?.format !== 'sparkling-standard-backup-parts' || !Array.isArray(manifest.parts)) {
    throw new Error('Invalid parts manifest.');
  }
  const directory = path.dirname(path.resolve(manifestPath));
  const output = fs.createWriteStream(path.resolve(outPath), { mode: 0o600 });
  const overall = crypto.createHash('sha256');
  try {
    for (const part of manifest.parts) {
      const partPath = path.join(directory, String(part.name));
      const bytes = await fsp.readFile(partPath);
      if (bytes.length !== Number(part.bytes)) throw new Error(`Part size mismatch: ${part.name}`);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest !== part.sha256) throw new Error(`Part checksum mismatch: ${part.name}`);
      overall.update(bytes);
      await new Promise((resolve, reject) => output.write(bytes, (error) => (error ? reject(error) : resolve())));
    }
    const finalSha = overall.digest('hex');
    if (finalSha !== manifest.originalSha256) throw new Error('Rejoined archive checksum does not match the manifest.');
    process.stdout.write(`${JSON.stringify({
      ok: true,
      archive: path.resolve(outPath),
      bytes: Number(manifest.originalBytes),
      sha256: finalSha,
    }, null, 2)}\n`);
  } finally {
    await new Promise((resolve) => output.end(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`join failed: ${error.message}\n`);
  process.exitCode = 1;
});
