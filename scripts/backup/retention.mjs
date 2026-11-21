#!/usr/bin/env node
// Preview or apply retention for the OneDrive encrypted backup destination.
// Dry-run is the default. The newest archive, pre-migration archives and
// explicit legal-hold IDs are never deleted.

import {
  DEFAULT_FOLDER,
  accessTokenFromEnvironment,
  deleteItemByPath,
  getDriveQuota,
  listBackupFolder,
} from './lib/onedrive.mjs';
import { backupBaseName, planRetention } from './lib/retention.mjs';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function values(name) {
  const output = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) output.push(args[index + 1]);
  }
  return output;
}

function flag(name) {
  return process.argv.slice(2).includes(name);
}

async function main() {
  const folder = process.env.ONEDRIVE_FOLDER?.trim() || DEFAULT_FOLDER;
  const token = await accessTokenFromEnvironment();
  const items = await listBackupFolder(token.accessToken, folder);
  const quota = await getDriveQuota(token.accessToken).catch(() => null);
  const cap = Math.max(1, Number(process.env.ONEDRIVE_CAPACITY_BYTES) || 5 * 1024 ** 3);
  const plan = planRetention(items, {
    daily: Number(arg('--daily', process.env.BACKUP_DAILY_RETENTION) || 30),
    weekly: Number(arg('--weekly', process.env.BACKUP_WEEKLY_RETENTION) || 12),
    monthly: Number(arg('--monthly', process.env.BACKUP_MONTHLY_RETENTION) || 12),
    legalHold: values('--legal-hold'),
    capacityBytes: cap,
  });
  const report = {
    ok: true,
    destination: 'onedrive',
    folder,
    dryRun: !flag('--apply'),
    quota,
    approvedCapacityBytes: cap,
    ...plan,
  };
  if (flag('--apply')) {
    const deleted = [];
    for (const bundle of plan.delete) {
      for (const item of items.filter((entry) => backupBaseName(entry.name) === bundle.id)) {
        await deleteItemByPath(token.accessToken, folder, item.name);
        deleted.push(item.name);
      }
    }
    report.deleted = deleted;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (plan.capacityExceeded) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`retention failed: ${error.message}\n`);
  process.exitCode = 1;
});
