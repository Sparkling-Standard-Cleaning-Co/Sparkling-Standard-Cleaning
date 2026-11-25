#!/usr/bin/env node
// Build a small, non-secret JSON result for the admin backup control plane.
// It never prints archive contents or credentials.
import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const operation = arg('--operation', 'backup');
const jobId = arg('--job-id', '');
const status = arg('--status', 'failure') === 'success' ? 'success' : 'failure';
const out = path.resolve(arg('--out', 'backup-out/report.json'));
const error = arg('--error', '');
const last = await readJson(path.resolve('backup-out/last-backup.json'));
const verifyR2 = await readJson(path.resolve('backup-out/verify-r2.json'));
const verifyOneDrive = await readJson(path.resolve('backup-out/verify-onedrive.json'));
const verifyArchive = await readJson(path.resolve('backup-out/verify.json'));
const restore = await readJson(path.resolve('backup-out/restore.json'));
const verifyRestore = await readJson(path.resolve('backup-out/verify-restore.json'));

const archivePath = String(last?.archive ?? arg('--archive', ''));
const archiveName = archivePath ? path.basename(archivePath) : arg('--archive-name', '');
const archiveKey = String(last?.upload?.archive?.key ?? arg('--archive-key', ''));
const archiveBytes = Number(last?.archiveBytes ?? 0) || null;
const fileCount = Number(last?.fileCount ?? 0) || null;
const archiveSha256 = String(last?.archiveSha256 ?? verifyArchive?.archive_sha256 ?? '');
const verifiedArchive = verifyR2 ?? verifyArchive;
const r2Verified = Boolean(verifiedArchive?.ok && (!verifiedArchive.databases || verifiedArchive.databases.every((db) => db.integrity === 'ok')));
const oneDriveVerified = Boolean(verifyOneDrive?.ok && (!verifyOneDrive.databases || verifyOneDrive.databases.every((db) => db.integrity === 'ok')));
const restorePassed = Boolean(verifyRestore?.ok);
const d1 = verifyRestore ?? verifyR2 ?? verifyOneDrive ?? verifyArchive;
const databases = Array.isArray(d1?.databases) ? d1.databases : [];
const summary = status === 'success'
  ? operation === 'backup'
    ? `Encrypted ${archiveName || 'backup'} created and independently verified.`
    : operation === 'restore_test'
      ? 'Archive verified and restored in an isolated environment.'
      : 'Encrypted archive verified.'
  : error || 'The backup operation failed or did not complete.';

const detail = {
  operation,
  archiveName,
  archiveKey,
  archiveBytes,
  fileCount,
  archiveSha256,
  r2Verified,
  oneDriveVerified,
  restorePassed,
  databases,
  ...(error ? { error } : {}),
};

await fs.mkdir(path.dirname(out), { recursive: true });
const report = { jobId, status, summary, archiveKey, detail };
await fs.writeFile(out, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report)}\n`);
