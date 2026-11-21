#!/usr/bin/env node
// Authorize and operate the independent OneDrive backup destination.
//
// The default OAuth scope is Files.ReadWrite.AppFolder. This deliberately uses
// OneDrive's application folder rather than granting the backup token access to
// every personal file. The owner folder is named Sparkling-Standard-Encrypted-Backups
// inside the app folder.
//
// Commands:
//   node scripts/backup/onedrive.mjs auth
//   node scripts/backup/onedrive.mjs upload --archive <path>
//   node scripts/backup/onedrive.mjs download --name <remote-name> --out <path>
//   node scripts/backup/onedrive.mjs list
//   node scripts/backup/onedrive.mjs quota
//   node scripts/backup/onedrive.mjs delete --name <remote-name> --confirm <remote-name>

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEFAULT_FOLDER,
  accessTokenFromEnvironment,
  deleteItemByPath,
  downloadFileByPath,
  ensureFolder,
  getDriveQuota,
  listBackupFolder,
  pollDeviceCode,
  requireGraphConfig,
  startDeviceCode,
  uploadFile,
  writeTokenCache,
} from './lib/onedrive.mjs';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.slice(2).includes(name);
}

function command() {
  return process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of (await import('node:fs')).createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function folderName() {
  return process.env.ONEDRIVE_FOLDER?.trim() || DEFAULT_FOLDER;
}

async function authCommand() {
  const config = requireGraphConfig();
  const device = await startDeviceCode(config);
  process.stdout.write([
    'Authorize the Sparkling Standard backup application:',
    `1. Open ${device.verification_uri}`,
    `2. Enter the one-time code: ${device.user_code}`,
    '3. Sign in with the personal Microsoft account that owns the backup storage.',
    '4. Approve the requested app-folder permission.',
    '',
    'No password is requested by this script. The refresh token is stored with Windows DPAPI and is never printed.',
    '',
  ].join('\n'));
  const token = await pollDeviceCode(config, device.device_code, fetch, {
    intervalSeconds: Number(device.interval ?? 5),
    expiresInSeconds: Number(device.expires_in ?? 900),
  });
  const cache = await writeTokenCache({ refreshToken: token.refreshToken, account: null });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    authorized: true,
    tokenCache: cache,
    scope: config.scope,
    note: 'To use this authorization in GitHub Actions, add the refresh token as the ONEDRIVE_REFRESH_TOKEN repository secret. Never paste it into chat or commit it.',
  }, null, 2)}\n`);
}

async function uploadCommand() {
  const archive = path.resolve(arg('--archive'));
  if (!archive || archive.startsWith('--')) throw new Error('Usage: node scripts/backup/onedrive.mjs upload --archive <path>');
  const stat = await fsp.stat(archive).catch(() => null);
  if (!stat?.isFile() || stat.size === 0) throw new Error(`Archive is missing or empty: ${archive}`);
  const base = archive.replace(/\.ssbk$/i, '');
  const candidates = [
    archive,
    `${base}.manifest.json.enc`,
    `${base}.sha256`,
  ];
  const files = [];
  for (const candidate of candidates) {
    const info = await fsp.stat(candidate).catch(() => null);
    if (!info?.isFile()) throw new Error(`Required backup sidecar is missing: ${candidate}`);
    files.push({ local: candidate, name: path.basename(candidate), bytes: info.size });
  }
  const token = await accessTokenFromEnvironment();
  await ensureFolder(token.accessToken, folderName());
  const uploaded = [];
  for (const file of files) {
    const result = await uploadFile(token.accessToken, folderName(), file.local, file.name);
    uploaded.push({ ...result, name: file.name, localSha256: await sha256File(file.local) });
    process.stderr.write(`uploaded ${file.name} (${file.bytes} bytes)\n`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    destination: 'onedrive',
    folder: folderName(),
    archive: path.basename(archive),
    archiveBytes: stat.size,
    archiveSha256: uploaded[0]?.localSha256 ?? '',
    uploaded,
  }, null, 2)}\n`);
}

async function downloadCommand() {
  const name = arg('--name');
  const out = path.resolve(arg('--out'));
  if (!name || !out || name.startsWith('--')) throw new Error('Usage: node scripts/backup/onedrive.mjs download --name <remote-name> --out <path>');
  const token = await accessTokenFromEnvironment();
  const result = await downloadFileByPath(token.accessToken, folderName(), name, out);
  process.stdout.write(`${JSON.stringify({ ok: true, destination: 'onedrive', name, ...result }, null, 2)}\n`);
}

async function listCommand() {
  const token = await accessTokenFromEnvironment();
  const items = await listBackupFolder(token.accessToken, folderName());
  const files = items.filter((item) => item.file).map((item) => ({
    name: item.name,
    bytes: item.size,
    modifiedAt: item.modifiedAt,
    webUrl: item.webUrl,
  }));
  process.stdout.write(`${JSON.stringify({ ok: true, folder: folderName(), files }, null, 2)}\n`);
}

async function quotaCommand() {
  const token = await accessTokenFromEnvironment();
  const quota = await getDriveQuota(token.accessToken);
  const cap = Math.max(1, Number(process.env.ONEDRIVE_CAPACITY_BYTES) || 5 * 1024 ** 3);
  const lowSpaceBytes = Math.max(0, Number(process.env.ONEDRIVE_LOW_SPACE_BYTES) || Math.round(cap * 0.15));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    driveQuota: quota,
    approvedCapacityBytes: cap,
    usedPercent: quota.totalBytes ? Math.round((quota.usedBytes / quota.totalBytes) * 10000) / 100 : null,
    lowSpace: quota.remainingBytes > 0 && quota.remainingBytes < lowSpaceBytes,
    lowSpaceThresholdBytes: lowSpaceBytes,
    note: 'The free personal OneDrive plan is assumed to be 5 GB unless ONEDRIVE_CAPACITY_BYTES is supplied.',
  }, null, 2)}\n`);
}

async function deleteCommand() {
  const name = arg('--name');
  const confirm = arg('--confirm');
  if (!name || name !== confirm) throw new Error('Deletion requires --name and a matching --confirm value.');
  const token = await accessTokenFromEnvironment();
  const result = await deleteItemByPath(token.accessToken, folderName(), name);
  process.stdout.write(`${JSON.stringify({ ok: true, destination: 'onedrive', ...result }, null, 2)}\n`);
}

async function main() {
  const cmd = command();
  if (cmd === 'auth') return authCommand();
  if (cmd === 'upload') return uploadCommand();
  if (cmd === 'download') return downloadCommand();
  if (cmd === 'list') return listCommand();
  if (cmd === 'quota') return quotaCommand();
  if (cmd === 'delete') return deleteCommand();
  throw new Error('Usage: node scripts/backup/onedrive.mjs auth|upload|download|list|quota|delete');
}

main().catch((error) => {
  process.stderr.write(`OneDrive backup command failed: ${error.message}\n`);
  process.exitCode = 1;
});
