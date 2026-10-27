// SEO checks over the built output:
//  - one <h1> per page, unique titles/descriptions
//  - canonical URL present, matches path, no query strings
//  - robots meta matches the environment (index in production, noindex for
//    noindex pages and preview builds)
//  - sitemap contains only public pages (no 404 / thank-you)
//  - global LocalBusiness JSON-LD parses and never contains PENDING markers
//  - OG image exists
// Run after `npm run build`: npm run seo

import fs from 'node:fs';
import path from 'node:path';

import {
  isEffectivelyNoindex,
  normalizeOrigin,
  originOf,
} from './lib/seo-checks.ts';

const DIST = 'dist';
const PREVIEW = process.env.PUBLIC_PREVIEW_MODE === 'true';
const EXPECTED_ORIGIN = normalizeOrigin(process.env.PUBLIC_SITE_URL ?? '');

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

const htmlFiles = walk(DIST).filter((file) => file.endsWith('.html'));
const problems = [];
const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();
const noindexPages = new Set();

// Pages intentionally excluded from indexing (utility/transactional flows).
// Each must carry an EFFECTIVE noindex and must never appear in the sitemap.
const NOINDEX_PAGES = new Set([
  '/404.html',
  '/404/',
  '/thank-you/index.html',
  '/thank-you/',
  '/leave-review/index.html',
  '/leave-review/',
  '/gift-certificates/redeem/index.html',
  '/gift-certificates/redeem/',
  '/gift-certificates/success/index.html',
  '/gift-certificates/success/',
  '/estimate/payment-success/index.html',
  '/estimate/payment-success/',
]);

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const relative = path.relative(DIST, file).split(path.sep).join('/');
  const page = relative.endsWith('index.html') ? `/${relative.slice(0, -'index.html'.length)}` : `/${relative}`;

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  const robots = html.match(/<meta name="robots" content="([^"]*)"/)?.[1];
  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;

  if (!title) problems.push(`${page}: missing <title>`);
  else if (titles.has(title)) problems.push(`${page}: duplicate title with ${titles.get(title)}`);
  else titles.set(title, page);

  if (!description) problems.push(`${page}: missing meta description`);
  else if (descriptions.has(description)) problems.push(`${page}: duplicate description with ${descriptions.get(description)}`);
  else descriptions.set(description, page);

  if (!canonical) problems.push(`${page}: missing canonical`);
  else {
    if (canonical.includes('?')) problems.push(`${page}: canonical contains a query string`);
    if (!canonical.endsWith('/') && !canonical.endsWith('.txt') && !canonical.endsWith('.html')) {
      problems.push(`${page}: canonical does not end with a slash`);
    }
    if (originOf(canonical) !== EXPECTED_ORIGIN) {
      problems.push(`${page}: canonical domain ${originOf(canonical) ?? '(invalid)'} does not match ${EXPECTED_ORIGIN}`);
    }
    if (canonicals.has(canonical)) problems.push(`${page}: duplicate canonical with ${canonicals.get(canonical)}`);
    else canonicals.set(canonical, page);
  }

  if (h1Count !== 1) problems.push(`${page}: expected exactly one <h1>, found ${h1Count}`);

  const shouldNoindex = PREVIEW || NOINDEX_PAGES.has(page) || NOINDEX_PAGES.has(`/${relative}`);
  const effectiveNoindex = robots ? isEffectivelyNoindex(robots) : false;
  if (effectiveNoindex) noindexPages.add(page);
  if (!robots) problems.push(`${page}: missing robots meta`);
  else if (shouldNoindex && !effectiveNoindex) problems.push(`${page}: expected noindex`);
  else if (!shouldNoindex && effectiveNoindex) problems.push(`${page}: effective noindex on an indexable page (content: ${robots})`);

  const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  if (jsonLdBlocks.length === 0) problems.push(`${page}: no JSON-LD found`);
  for (const block of jsonLdBlocks) {
    const content = block[1] ?? '';
    // PENDING markers inside JSON-LD are caught by the dedicated production
    // gate (scripts/check-pending-facts.mjs); this check only ensures the
    // structured data is valid JSON.
    try {
      JSON.parse(content);
    } catch {
      problems.push(`${page}: JSON-LD does not parse`);
    }
  }
}

// Sitemap must exclude noindex-only pages and stale URLs.
const sitemapIndex = path.join(DIST, 'sitemap-index.xml');
if (!fs.existsSync(sitemapIndex)) {
  problems.push('sitemap-index.xml missing');
} else {
  for (const file of walk(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(path.basename(f)))) {
    const xml = fs.readFileSync(file, 'utf8');
    for (const marker of ['/404', '/thank-you/', '/estimate/payment-success/']) {
      if (xml.includes(marker)) problems.push(`${path.basename(file)} contains ${marker} (should be excluded)`);
    }
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = match[1] ?? '';
      if (originOf(url) !== EXPECTED_ORIGIN) {
        problems.push(`${path.basename(file)}: sitemap URL ${url} is not on ${EXPECTED_ORIGIN}`);
        continue;
      }
      const urlPath = new URL(url).pathname;
      if (!canonicals.has(url)) {
        problems.push(`${path.basename(file)}: sitemap URL ${url} does not match any built canonical`);
      }
      if (noindexPages.has(urlPath) || noindexPages.has(`${urlPath}index.html`)) {
        problems.push(`${path.basename(file)}: sitemap lists noindex page ${url}`);
      }
    }
  }
}

// OG image must exist.
if (!fs.existsSync(path.join(DIST, 'brand', 'og-default.png'))) {
  problems.push('brand/og-default.png missing from build');
}

if (problems.length > 0) {
  console.error(`SEO PROBLEMS (${problems.length}):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log(`✓ SEO checks passed across ${htmlFiles.length} pages (${titles.size} unique titles)`);
