// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { decryptBuffer } from '../scripts/backup/lib/crypto.mjs';
import {
  extractEncryptedArchive,
  listFiles,
  sha256File,
  writeEncryptedArchive,
  writeManifest,
} from '../scripts/backup/lib/archive.mjs';
import { buildSignedRequest, listAllObjects } from '../scripts/backup/lib/r2.mjs';

const KEY = crypto.randomBytes(32);
const KEY_BASE64 = KEY.toString('base64');

async function tempDir(prefix: string): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function fixtureSource(): Promise<{ root: string; files: Array<{ absolute: string; path: string }> }> {
  const root = await tempDir('ss-backup-source-');
  await fsp.mkdir(path.join(root, 'papers'), { recursive: true });
  await fsp.mkdir(path.join(root, 'videos'), { recursive: true });
  await fsp.writeFile(path.join(root, 'papers', 'agreement.txt'), 'Synthetic agreement text\n');
  await fsp.writeFile(path.join(root, 'papers', 'records.json'), JSON.stringify({ synthetic: true }));
  await fsp.writeFile(path.join(root, 'videos', 'sample.bin'), crypto.randomBytes(64 * 1024));
  await fsp.writeFile(path.join(root, 'database.sql'), 'CREATE TABLE synthetic (id TEXT PRIMARY KEY, value TEXT);\nINSERT INTO synthetic VALUES (\'1\', \'ok\');\n');
  return { root, files: await listFiles(root) };
}

test('an encrypted archive round-trips every file, hash and manifest without exposing plaintext', async () => {
  const source = await fixtureSource();
  const out = await tempDir('ss-backup-out-');
  const archivePath = path.join(out, 'backup.ssbk');
  const result = await writeEncryptedArchive({
    entries: source.files.map((file) => ({ absolute: file.absolute, path: file.path })),
    outPath: archivePath,
    key: KEY,
  });
  assert.equal(result.entries.length, 4);
  assert.equal(result.archiveSha256.length, 64);
  const encrypted = await fsp.readFile(archivePath);
  assert.equal(encrypted.subarray(0, 5).toString('utf8'), 'SSBA1');
  assert.equal(encrypted.includes(Buffer.from('Synthetic agreement text')), false);
  assert.equal(encrypted.includes(Buffer.from('CREATE TABLE synthetic')), false);

  const manifest = {
    format: 'sparkling-standard-backup',
    version: 1,
    archive: path.basename(archivePath),
    archiveSha256: result.archiveSha256,
    entries: result.entries,
  };
  const manifestResult = await writeManifest({
    manifest,
    jsonPath: path.join(out, 'backup.manifest.json'),
    key: KEY,
  });
  assert.ok((await fsp.stat(manifestResult.encryptedPath)).size > 0);
  const decoded = JSON.parse(decryptBuffer(await fsp.readFile(manifestResult.encryptedPath), KEY).toString('utf8'));
  assert.equal(decoded.archiveSha256, result.archiveSha256);

  const restoreDir = path.join(out, 'restore');
  const extracted = await extractEncryptedArchive({ archivePath, outDir: restoreDir, key: KEY });
  assert.equal(extracted.entries.length, result.entries.length);
  const original = await fsp.readFile(path.join(source.root, 'papers', 'agreement.txt'), 'utf8');
  const restored = await fsp.readFile(path.join(restoreDir, 'papers', 'agreement.txt'), 'utf8');
  assert.equal(restored, original);
  assert.equal(await sha256File(path.join(source.root, 'videos', 'sample.bin')), await sha256File(path.join(restoreDir, 'videos', 'sample.bin')));
  assert.deepEqual(extracted.entries.map((entry) => entry.path).sort(), result.entries.map((entry) => entry.path).sort());

  await assert.rejects(
    () => extractEncryptedArchive({ archivePath, outDir: path.join(out, 'wrong-key'), key: crypto.randomBytes(32) }),
    /unable to authenticate|bad decrypt|authenticate|unreasonably large/i,
  );
});

test('a single tampered byte or truncated archive is rejected', async () => {
  const source = await fixtureSource();
  const out = await tempDir('ss-backup-tamper-');
  const archivePath = path.join(out, 'backup.ssbk');
  await writeEncryptedArchive({
    entries: source.files.map((file) => ({ absolute: file.absolute, path: file.path })),
    outPath: archivePath,
    key: KEY,
  });
  const bytes = await fsp.readFile(archivePath);
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 40] ^= 0xff;
  const tamperedPath = path.join(out, 'tampered.ssbk');
  await fsp.writeFile(tamperedPath, tampered);
  await assert.rejects(
    () => extractEncryptedArchive({ archivePath: tamperedPath, outDir: path.join(out, 'tampered') , key: KEY }),
    /authenticate|bad decrypt|Integrity check failed/i,
  );
  const truncatedPath = path.join(out, 'truncated.ssbk');
  await fsp.writeFile(truncatedPath, bytes.subarray(0, bytes.length - 100));
  await assert.rejects(
    () => extractEncryptedArchive({ archivePath: truncatedPath, outDir: path.join(out, 'truncated'), key: KEY }),
    /Archive ended|authenticate|bad decrypt/i,
  );
});

test('the verify command proves hashes and a D1 SQL export integrity check', async () => {
  const source = await fixtureSource();
  const out = await tempDir('ss-backup-verify-');
  const archivePath = path.join(out, 'backup.ssbk');
  const entries = source.files.map((file) => ({ absolute: file.absolute, path: file.path }));
  await writeEncryptedArchive({ entries, outPath: archivePath, key: KEY });
  const output = execFileSync(process.execPath, ['scripts/backup/verify.mjs', archivePath], {
    env: { ...process.env, BACKUP_ENCRYPTION_KEY: KEY_BASE64 },
    encoding: 'utf8',
  });
  const report = JSON.parse(output);
  assert.equal(report.ok, true);
  assert.equal(report.fileCount, 4);
  assert.equal(report.databases.length, 1);
  assert.equal(report.databases[0].integrity, 'ok');
  assert.equal(report.databases[0].tables, 1);
});

test('restore refuses to overwrite a non-empty directory and restores into an isolated one', async () => {
  const source = await fixtureSource();
  const out = await tempDir('ss-backup-restore-');
  const archivePath = path.join(out, 'backup.ssbk');
  await writeEncryptedArchive({
    entries: source.files.map((file) => ({ absolute: file.absolute, path: file.path })),
    outPath: archivePath,
    key: KEY,
  });
  const nonEmpty = path.join(out, 'non-empty');
  await fsp.mkdir(nonEmpty);
  await fsp.writeFile(path.join(nonEmpty, 'keep.txt'), 'keep');
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/backup/restore.mjs', archivePath, '--out', nonEmpty], {
      env: { ...process.env, BACKUP_ENCRYPTION_KEY: KEY_BASE64 },
      encoding: 'utf8',
    }),
    /non-empty directory/,
  );
  const target = path.join(out, 'isolated');
  const restored = JSON.parse(execFileSync(process.execPath, ['scripts/backup/restore.mjs', archivePath, '--out', target], {
    env: { ...process.env, BACKUP_ENCRYPTION_KEY: KEY_BASE64 },
    encoding: 'utf8',
  }));
  assert.equal(restored.ok, true);
  assert.equal(restored.fileCount, 4);
  assert.equal(await fsp.readFile(path.join(target, 'papers', 'agreement.txt'), 'utf8'), 'Synthetic agreement text\n');
});

test('R2 requests are signed and object listings paginate without exposing credentials', async () => {
  const config = {
    endpoint: 'https://synthetic-account.r2.cloudflarestorage.com',
    bucket: 'synthetic-backup-bucket',
    accessKeyId: 'synthetic-access-key',
    secretAccessKey: 'synthetic-secret-key',
  };
  const signed = buildSignedRequest(config, {
    method: 'PUT',
    key: 'sparkling-standard/backups/archive.ssbk',
    payloadHash: 'a'.repeat(64),
    contentType: 'application/octet-stream',
  });
  assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 Credential=synthetic-access-key\//);
  assert.match(signed.headers.authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/);
  assert.match(signed.url, /^https:\/\/synthetic-account\.r2\.cloudflarestorage\.com\/synthetic-backup-bucket\/sparkling-standard\/backups\/archive\.ssbk$/);
  assert.equal(JSON.stringify(signed).includes('synthetic-secret-key'), false);

  const responses = [
    '<ListBucketResult><Contents><Key>backups/a.ssbk</Key><Size>10</Size><LastModified>2026-11-19T00:00:00Z</LastModified></Contents><NextContinuationToken>next</NextContinuationToken></ListBucketResult>',
    '<ListBucketResult><Contents><Key>backups/b.ssbk</Key><Size>20</Size></Contents></ListBucketResult>',
  ];
  let calls = 0;
  const objects = await listAllObjects(config, 'backups/', async (url, init) => {
    calls += 1;
    assert.match(url, /list-type=2/);
    assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256/);
    return new Response(responses.shift(), { status: 200 });
  });
  assert.equal(calls, 2);
  assert.deepEqual(objects.map((object) => object.key), ['backups/a.ssbk', 'backups/b.ssbk']);
  assert.deepEqual(objects.map((object) => object.size), [10, 20]);
});
