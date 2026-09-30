// IndexNow submission — notify search engines about changed canonical URLs.
//
// Requires (post-launch only):
//   PUBLIC_SITE_URL=https://your-domain.com
//   INDEXNOW_KEY=<a random 8-128 char key you also host at /<key>.txt>
//
// Usage:
//   node scripts/indexnow.mjs --all               submit every sitemap URL
//   node scripts/indexnow.mjs --urls /a/ /b/      submit specific paths
//   node scripts/indexnow.mjs --range 1..10       submit sitemap entries 1..10
//
// Never runs in preview mode; never invents URLs.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const SITE_URL = (process.env.PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.INDEXNOW_KEY ?? '';

if (!SITE_URL || SITE_URL.includes('.invalid')) {
  console.error('PUBLIC_SITE_URL is not configured — IndexNow is a post-launch tool. Nothing submitted.');
  process.exit(1);
}
if (!KEY) {
  console.error('INDEXNOW_KEY is not set. Create a key, host it at /<key>.txt, then retry.');
  process.exit(1);
}
if (process.env.PUBLIC_PREVIEW_MODE === 'true') {
  console.error('Preview mode — refusing to submit URLs for indexing.');
  process.exit(1);
}

function sitemapUrls() {
  const sitemapDir = 'dist';
  if (!fs.existsSync(sitemapDir)) {
    console.error('dist/ not found — run npm run build first.');
    process.exit(1);
  }
  const files = fs
    .readdirSync(sitemapDir)
    .filter((file) => /^sitemap-\d+\.xml$/.test(file));
  const urls = [];
  for (const file of files) {
    const xml = fs.readFileSync(path.join(sitemapDir, file), 'utf8');
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const loc = match[1];
      if (loc?.startsWith(SITE_URL)) urls.push(loc);
    }
  }
  return urls;
}

let urls = [];
if (args.includes('--all')) {
  urls = sitemapUrls();
} else if (args.includes('--urls')) {
  urls = args
    .slice(args.indexOf('--urls') + 1)
    .filter((arg) => !arg.startsWith('--'))
    .map((p) => new URL(p, `${SITE_URL}/`).href);
} else if (args.includes('--range')) {
  const range = args[args.indexOf('--range') + 1] ?? '';
  const [from, to] = range.split('..').map(Number);
  const all = sitemapUrls();
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    console.error('Invalid --range, expected e.g. 1..10');
    process.exit(1);
  }
  urls = all.slice(from - 1, to);
} else {
  console.error('Usage: node scripts/indexnow.mjs --all | --urls <paths…> | --range <from>..<to>');
  process.exit(1);
}

if (urls.length === 0) {
  console.error('No URLs to submit.');
  process.exit(1);
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: new URL(SITE_URL).host,
    key: KEY,
    keyLocation: `${SITE_URL}/${KEY}.txt`,
    urlList: urls,
  }),
});

if (response.ok || response.status === 202) {
  console.log(`✓ IndexNow accepted ${urls.length} URL(s) (HTTP ${response.status})`);
} else {
  console.error(`IndexNow submission failed: HTTP ${response.status}`);
  process.exit(1);
}
