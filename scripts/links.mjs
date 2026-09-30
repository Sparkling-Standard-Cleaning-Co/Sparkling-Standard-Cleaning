// Broken internal-link checker — scans the built dist/ output.
// Run after `npm run build`: npm run links

import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run npm run build first');
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

const files = walk(DIST);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const assetSet = new Set(
  files.map((file) => `/${path.relative(DIST, file).split(path.sep).join('/')}`),
);

const problems = [];
let checked = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const page = `/${path.relative(DIST, file).split(path.sep).join('/')}`;
  const linkRegex = /(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith('#')) continue;
    if (/^(https?:|mailto:|tel:|sms:|data:)/i.test(raw)) continue;
    if (!raw.startsWith('/')) continue;
    checked += 1;

    const withoutHash = raw.split('#')[0];
    const withoutQuery = withoutHash.split('?')[0];
    if (!withoutQuery) continue;

    const decoded = decodeURIComponent(withoutQuery);
    const candidates = decoded.endsWith('/')
      ? [`${decoded}index.html`, decoded]
      : [decoded, `${decoded}/index.html`, `${decoded}.html`];

    const found = candidates.some((candidate) => assetSet.has(candidate));
    if (!found) {
      problems.push(`${page} → ${raw}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`BROKEN INTERNAL LINKS (${problems.length}):`);
  for (const problem of [...new Set(problems)]) console.error(` - ${problem}`);
  process.exit(1);
}

console.log(`✓ ${checked} internal links across ${htmlFiles.length} pages all resolve`);
