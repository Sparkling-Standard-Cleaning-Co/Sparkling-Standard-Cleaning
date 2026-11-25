#!/usr/bin/env node
// Preview or apply retention for the encrypted R2 backup bucket.
// Dry-run is the default. The newest archive, pre-migration archives and
// explicit legal-hold IDs are never deleted.

import { deleteObject, listAllObjects, requireR2Config } from './lib/r2.mjs';
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
  const config = requireR2Config();
  const prefix = (arg('--prefix', 'sparkling-standard/backups').replace(/^\/+|\/+$/g, ''));
  const objects = await listAllObjects(config, `${prefix}/`);
  const items = objects.map((object) => ({
    name: object.key,
    bytes: object.size,
    modifiedAt: object.lastModified,
  }));
  const plan = planRetention(items, {
    daily: Number(arg('--daily', process.env.BACKUP_DAILY_RETENTION) || 30),
    weekly: Number(arg('--weekly', process.env.BACKUP_WEEKLY_RETENTION) || 12),
    monthly: Number(arg('--monthly', process.env.BACKUP_MONTHLY_RETENTION) || 12),
    legalHold: values('--legal-hold'),
    capacityBytes: Number(process.env.BACKUP_R2_CAPACITY_BYTES) || null,
  });
  const report = {
    ok: true,
    destination: 'r2',
    bucket: config.bucket,
    prefix,
    dryRun: !flag('--apply'),
    ...plan,
  };
  if (flag('--apply')) {
    const deleted = [];
    for (const bundle of plan.delete) {
      for (const item of items.filter((entry) => backupBaseName(entry.name) === bundle.id)) {
        await deleteObject(config, item.name);
        deleted.push(item.name);
      }
    }
    report.deleted = deleted;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (plan.capacityExceeded) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`R2 retention failed: ${error.message}\n`);
  process.exitCode = 1;
});
