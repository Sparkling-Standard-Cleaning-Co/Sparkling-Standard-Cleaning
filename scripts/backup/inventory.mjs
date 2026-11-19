#!/usr/bin/env node
// Report file counts and sizes by category before designing a backup scope.
//
// Usage: node scripts/backup/inventory.mjs <directory> [<directory> ...]

import { inventory } from './lib/archive.mjs';

async function main() {
  const roots = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  if (roots.length === 0) throw new Error('Usage: node scripts/backup/inventory.mjs <directory> [...]');
  const reports = [];
  for (const root of roots) reports.push(await inventory(root));
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`inventory failed: ${error.message}\n`);
  process.exitCode = 1;
});
