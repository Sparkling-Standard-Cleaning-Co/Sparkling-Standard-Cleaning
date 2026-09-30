// Fake-testimonial / fake-proof detector (directive §77).
//
// Fails if demo/fixture reviews, invented customer names, or stock "before and
// after" placeholder assets appear anywhere in the content or the build.
// Reviews are added ONLY from genuine, owner-supplied customer feedback.

import fs from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.join('src', 'content');
const DIST = 'dist';

const FORBIDDEN_PATTERNS = [
  /\bSarah M\./i,
  /\bJohn D\./i,
  /\bJane D\./i,
  /\bTest Customer\b/i,
  /\bLorem ipsum\b/i,
  /\bsample review\b/i,
  /\bplaceholder review\b/i,
  /\bfake review\b/i,
  /\bdemo review\b/i,
  /\bexample\.[a-z]{2,}\b/i,
  /\bDoe,?\s+(Pensacola|Cantonment)\b/i,
];

const problems = [];

function scan(file, content) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      problems.push(`${file}: matches ${pattern}`);
    }
  }
}

function walk(dir) {
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      entries.push(...walk(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

for (const file of walk('src')) {
  if (!/\.(md|astro|ts|json)$/.test(file)) continue;
  scan(file, fs.readFileSync(file, 'utf8'));
}

if (fs.existsSync(DIST)) {
  for (const file of walk(DIST)) {
    if (!/\.(html|xml|txt)$/.test(file)) continue;
    scan(file, fs.readFileSync(file, 'utf8'));
  }
}

if (problems.length > 0) {
  console.error('FAKE TESTIMONIAL / FIXTURE MARKERS FOUND:');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log('✓ no fake testimonial or fixture markers found');
