// PENDING-fact detector — scans the built output for placeholder business
// facts that must NEVER reach production (directive §79, §81, §103).
//
// This check is EXPECTED to fail while the business is pre-launch. It is the
// gate that stops a PENDING brand from being indexed: run it as part of the
// production deployment checklist (see docs/DEPLOYMENT.md).
//
// Usage: node scripts/check-pending-facts.mjs [--dist <dir>]

import fs from 'node:fs';
import path from 'node:path';

const DIST = process.argv.includes('--dist')
  ? process.argv[process.argv.indexOf('--dist') + 1]
  : 'dist';

if (!fs.existsSync(DIST)) {
  console.error(`${DIST}/ not found — run npm run build first`);
  process.exit(1);
}

function walk(dir) {
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) entries.push(...walk(full));
    else entries.push(full);
  }
  return entries;
}

const HARD_MARKERS = [
  { pattern: /PENDING_BUSINESS_NAME/, label: 'placeholder business name' },
  { pattern: /pending-website-url\.invalid/, label: 'placeholder production URL' },
  { pattern: /PENDING_BUSINESS_PHONE/, label: 'placeholder phone' },
];

const files = walk(DIST).filter((file) => file.endsWith('.html') || file.endsWith('.xml') || file.endsWith('.txt'));
const problems = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const relative = path.relative(DIST, file).split(path.sep).join('/');
  for (const marker of HARD_MARKERS) {
    if (marker.pattern.test(content)) {
      problems.push(`${relative}: contains ${marker.label} (${marker.pattern})`);
    }
  }
}

if (problems.length > 0) {
  console.error('PRODUCTION BLOCKED — PENDING facts found in the build:');
  for (const problem of [...new Set(problems)]) console.error(` - ${problem}`);
  console.error('\nResolve every item in docs/launch/OWNER-INPUT-REQUIRED.md marked');
  console.error('BLOCKS PRODUCTION, set the environment values, rebuild, and rerun.');
  process.exit(1);
}

console.log(`✓ no PENDING placeholder facts across ${files.length} built files`);
