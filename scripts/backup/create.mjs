#!/usr/bin/env node
// Create one encrypted, integrity-checked off-site backup archive.
//
// Usage:
//   node scripts/backup/create.mjs --source "website=." --out backup-out
//   node scripts/backup/create.mjs --d1 backup-out/d1.sql --source "videos=C:\...\03-Photos-and-Videos" --upload

import fsp from 'node:fs/promises';
import path from 'node:path';
import { decodeKey } from './lib/crypto.mjs';
import { inventory, listFiles, sha256File, writeEncryptedArchive, writeManifest } from './lib/archive.mjs';
import { putFile, requireR2Config } from './lib/r2.mjs';

function argValues(name) {
  const values = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function flag(name) {
  return process.argv.slice(2).includes(name);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function main() {
  const key = decodeKey(process.env.BACKUP_ENCRYPTION_KEY);
  const outDir = path.resolve(argValues('--out')[0] ?? 'backup-out');
  await fsp.mkdir(outDir, { recursive: true });
  const sources = argValues('--source').map((value) => {
    const separator = value.indexOf('=');
    if (separator < 1) throw new Error('Each --source must be label=path.');
    return {
      label: value.slice(0, separator),
      root: path.resolve(value.slice(separator + 1)),
    };
  });
  const d1Files = argValues('--d1').map((value) => path.resolve(value));
  if (sources.length === 0 && d1Files.length === 0) {
    throw new Error('Provide at least one --source label=path or --d1 file.');
  }

  const excluded = new Set(argValues('--exclude'));
  const entries = [];
  const sourceReports = [];
  for (const source of sources) {
    const files = await listFiles(source.root, { exclude: [...excluded] });
    for (const file of files) {
      entries.push({ absolute: file.absolute, path: `${source.label}/${file.path}` });
    }
    sourceReports.push(await inventory(source.root, { exclude: [...excluded] }));
  }
  for (const d1 of d1Files) {
    const stat = await fsp.stat(d1);
    if (!stat.isFile() || stat.size === 0) throw new Error(`D1 export is missing or empty: ${d1}`);
    entries.push({ absolute: d1, path: `database/${path.basename(d1)}` });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const label = (argValues('--label')[0] ?? process.env.BACKUP_ARCHIVE_LABEL ?? '').trim().toLowerCase();
  if (label && !/^[a-z0-9-]{1,20}$/.test(label)) throw new Error('Backup label is invalid.');
  const baseName = `sparkling-standard-backup-${stamp()}${label ? `-${label}` : ''}`;
  const archivePath = path.join(outDir, `${baseName}.ssbk`);
  const result = await writeEncryptedArchive({
    entries,
    outPath: archivePath,
    key,
    onProgress: (progress) => {
      if (progress.files % 100 === 0) {
        process.stderr.write(`archived ${progress.files} file(s), ${(progress.bytes / 1024 / 1024).toFixed(1)} MB\n`);
      }
    },
  });
  const manifest = {
    format: 'sparkling-standard-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    archive: path.basename(archivePath),
    archiveSha256: result.archiveSha256,
    archiveBytes: (await fsp.stat(archivePath)).size,
    plainBytes: result.plainBytes,
    fileCount: result.entries.length,
    sources: sourceReports,
    databaseExports: d1Files.map((file) => path.basename(file)),
    entries: result.entries,
    encryption: 'AES-256-GCM',
    restoreCommand: `node scripts/backup/restore.mjs "<archive>" --out <empty-directory>`,
  };
  const manifestResult = await writeManifest({
    manifest,
    jsonPath: path.join(outDir, `${baseName}.manifest.json`),
    key,
  });
  const archiveShaPath = path.join(outDir, `${baseName}.sha256`);
  await fsp.writeFile(archiveShaPath, `${result.archiveSha256}  ${path.basename(archivePath)}\n`, { mode: 0o600 });

  let upload = null;
  if (flag('--upload')) {
    const config = requireR2Config();
    const prefix = (argValues('--prefix')[0] ?? 'sparkling-standard/backups').replace(/^\/+|\/+$/g, '');
    upload = {
      archive: await putFile(config, `${prefix}/${path.basename(archivePath)}`, archivePath, 'application/octet-stream'),
      manifest: await putFile(config, `${prefix}/${path.basename(manifestResult.encryptedPath)}`, manifestResult.encryptedPath, 'application/octet-stream'),
      checksum: await putFile(config, `${prefix}/${path.basename(archiveShaPath)}`, archiveShaPath, 'text/plain'),
    };
  }

  const report = {
    createdAt: manifest.createdAt,
    archive: archivePath,
    archiveSha256: result.archiveSha256,
    archiveBytes: manifest.archiveBytes,
    plainBytes: manifest.plainBytes,
    fileCount: manifest.fileCount,
    manifest: manifestResult.jsonPath,
    manifestEncrypted: manifestResult.encryptedPath,
    upload,
  };
  await fsp.writeFile(path.join(outDir, 'last-backup.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`backup failed: ${error.message}\n`);
  process.exitCode = 1;
});
