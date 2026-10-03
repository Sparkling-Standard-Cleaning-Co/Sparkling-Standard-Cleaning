// Site validation umbrella — runs the static checks that need a build:
//   1. broken internal links
//   2. SEO checks (titles, canonicals, robots, schema, sitemap)
//   3. marketing registry + generated-doc + QR decode verification
//   4. GTM import artifact verification (GA4 event mapping stays in sync)
//   5. internal-checklist leak check (operational docs must not publish)
//
// Usage: npm run validate   (after npm run build)
// The PENDING-fact gate is intentionally separate: npm run pending.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (!fs.existsSync('dist')) {
  console.error('dist/ not found — run npm run build first');
  process.exit(1);
}

function run(label, script, scriptArgs = []) {
  process.stdout.write(`\n── ${label} ──\n`);
  execFileSync(process.execPath, [script, ...scriptArgs], { stdio: 'inherit' });
}

run('internal links', 'scripts/links.mjs');
run('SEO', 'scripts/verify-seo.mjs');
run('marketing registry + QR verification', 'scripts/generate-marketing-links.mjs', ['--check']);
run('GTM import artifacts', 'scripts/generate-gtm-import.mjs', ['--check']);

// ── Internal-checklist leak check ────────────────────────────────────────────
process.stdout.write('\n── internal checklist leak check ──\n');
const CHECKLIST_DIR = path.join('src', 'content', 'checklists');
const internalTitles = [];
if (fs.existsSync(CHECKLIST_DIR)) {
  for (const file of fs.readdirSync(CHECKLIST_DIR)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(CHECKLIST_DIR, file), 'utf8');
    if (!/visibility:\s*internal/.test(content)) continue;
    const title = content.match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (title) internalTitles.push({ file, title });
  }
}

const leaks = [];
function walk(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.html')) out.push(full);
  }
  return out;
}
for (const file of walk('dist')) {
  const html = fs.readFileSync(file, 'utf8');
  for (const { title } of internalTitles) {
    if (html.includes(title)) leaks.push(`${path.relative('dist', file)} contains internal checklist "${title}"`);
  }
}
if (leaks.length > 0) {
  console.error('INTERNAL CHECKLIST LEAK:');
  for (const leak of leaks) console.error(` - ${leak}`);
  process.exit(1);
}
console.log(`✓ ${internalTitles.length} internal checklist(s) verified absent from the public build`);

process.stdout.write('\n✓ validate-site complete\n');
