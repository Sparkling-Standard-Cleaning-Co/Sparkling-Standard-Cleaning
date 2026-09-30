// No-fabrication audit (directive §105).
//
// Scans content and the built output for unsupported factual claims:
// invented years in business, review counts, customer counts, credentials,
// guarantees and superlatives. Hard-banned patterns fail the audit; soft
// patterns (terms that are legitimate only in negative/exclusion contexts)
// are reported for human review.
//
// Usage: node scripts/audit-facts.mjs

import fs from 'node:fs';
import path from 'node:path';

const HARD_BANNED = [
  { pattern: /\b\d+\s*\+?\s*years?\b/i, label: 'years in business' },
  { pattern: /\byears? of experience\b/i, label: 'years of experience claim' },
  { pattern: /\b\d+\s*\+?\s*(happy\s+)?customers\b/i, label: 'customer count' },
  { pattern: /\b\d+\s*\+?\s*(five|5)[- ]star\b/i, label: 'star-rating claim' },
  { pattern: /\b\d+(\.\d+)?\s*star\b/i, label: 'star-rating claim' },
  { pattern: /\b\d+\s*\+?\s*reviews?\b/i, label: 'review count' },
  { pattern: /\bfully insured\b|\bwe are insured\b|\bliscensed\b|\bbonded and insured\b/i, label: 'insurance/bonding claim' },
  { pattern: /\baward[- ]winning\b/i, label: 'award claim' },
  { pattern: /\bbest (in|cleaning|company)\b/i, label: 'superlative claim' },
  { pattern: /\bcheapest\b|\blowest price/i, label: 'price superlative' },
  { pattern: /\b#1\b/, label: 'rank claim' },
  { pattern: /\bmoney[- ]back guarantee\b/i, label: 'guarantee claim' },
  { pattern: /\b24\s*\/\s*7\b/, label: '24/7 claim' },
];

const REVIEW_TERMS = [
  { pattern: /\binsured\b/i, label: 'insured' },
  { pattern: /\bbonded\b/i, label: 'bonded' },
  { pattern: /\blicensed\b/i, label: 'licensed' },
  { pattern: /\bcertified\b/i, label: 'certified' },
  { pattern: /\bguarantee\b/i, label: 'guarantee (verify context)' },
  { pattern: /\b100%/i, label: '100% claim' },
];

function walk(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (['node_modules', '.git', '.astro'].includes(item.name)) continue;
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const targets = [
  ...walk('src').filter((file) => /\.(md|astro|ts)$/.test(file)),
  ...(fs.existsSync('dist') ? walk('dist').filter((file) => file.endsWith('.html')) : []),
];

const failures = [];
const review = [];

for (const file of targets) {
  const content = fs.readFileSync(file, 'utf8');
  for (const { pattern, label } of HARD_BANNED) {
    const match = content.match(pattern);
    if (match) failures.push(`${file}: [${label}] "${match[0]}"`);
  }
  for (const { pattern, label } of REVIEW_TERMS) {
    const match = content.match(pattern);
    if (match) review.push(`${file}: [${label}] "${match[0]}"`);
  }

  // "guaranteed" is only a violation as a POSITIVE claim — the anti-bait-and-switch
  // copy deliberately says "not a guaranteed price". Check the context window.
  const guaranteeRegex = /\bguaranteed?\b/gi;
  let guaranteeMatch;
  while ((guaranteeMatch = guaranteeRegex.exec(content)) !== null) {
    const window = content.slice(Math.max(0, guaranteeMatch.index - 40), guaranteeMatch.index).toLowerCase();
    const negated = /\b(not|never|no|isn't|without)\b/.test(window);
    if (!negated) {
      failures.push(`${file}: [guarantee claim] "${guaranteeMatch[0]}" without a negation nearby`);
    }
  }
}

if (review.length > 0) {
  console.log(
    `Terms needing human context review (${review.length}) — confirm each is a negative`,
  );
  console.log('exclusion statement or an owner-approved fact, not a positive claim:');
  for (const item of [...new Set(review)].slice(0, 40)) console.log(` · ${item}`);
  console.log('');
}

if (failures.length > 0) {
  console.error(`NO-FABRICATION AUDIT FAILED (${failures.length}):`);
  for (const failure of [...new Set(failures)]) console.error(` ✗ ${failure}`);
  process.exit(1);
}

console.log('✓ no unsupported factual claims detected');
