import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HOST = 'sparkling-standard.com';
const ORIGIN = `https://${HOST}`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const STATE_DIR = 'indexnow-out';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SITEMAP_FILE = path.join('dist', 'sitemap-0.xml');
const PUBLIC_DIR = 'public';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const submitAll = args.has('--all');

function fail(message) {
  console.error(`indexnow: ${message}`);
  process.exit(1);
}

function findKey() {
  if (!fs.existsSync(PUBLIC_DIR)) fail('public directory not found');
  const candidates = fs
    .readdirSync(PUBLIC_DIR)
    .filter((name) => /^[a-f0-9]{32}\.txt$/.test(name));
  if (candidates.length !== 1) {
    fail(`expected exactly one IndexNow key file in public/, found ${candidates.length}`);
  }
  const fileName = candidates[0];
  const key = fileName.replace(/\.txt$/, '');
  const content = fs.readFileSync(path.join(PUBLIC_DIR, fileName), 'utf8').trim();
  if (content !== key) fail(`${fileName} must contain only the key`);
  return { key, keyLocation: `${ORIGIN}/${fileName}` };
}

function readSitemapUrls() {
  if (!fs.existsSync(SITEMAP_FILE)) fail('dist/sitemap-0.xml not found - run npm run build first');
  const xml = fs.readFileSync(SITEMAP_FILE, 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  const unique = [...new Set(urls)];
  for (const url of unique) {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN) fail(`sitemap URL is outside ${ORIGIN}: ${url}`);
    if (parsed.search || parsed.hash) fail(`sitemap URL is not canonical: ${url}`);
  }
  if (unique.length === 0) fail('sitemap contains no URLs');
  return unique;
}

function builtFileFor(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const full = path.resolve('dist', `.${relative}`);
  const root = path.resolve('dist');
  if (!full.startsWith(root + path.sep)) fail(`unsafe sitemap path: ${url}`);
  if (!fs.existsSync(full)) fail(`built page missing for ${url}: ${full}`);
  return full;
}

function hashPage(url) {
  return crypto.createHash('sha256').update(fs.readFileSync(builtFileFor(url))).digest('hex');
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).urls ?? {};
  } catch {
    fail(`could not parse ${STATE_FILE}; delete it to resubmit all URLs`);
  }
}

const { key, keyLocation } = findKey();
const urls = readSitemapUrls();
const previous = readState();
const current = Object.fromEntries(urls.map((url) => [url, hashPage(url)]));
const changed = submitAll ? urls : urls.filter((url) => previous[url] !== current[url]);
const removed = submitAll ? [] : Object.keys(previous).filter((url) => !(url in current));
const urlList = [...new Set([...changed, ...removed])];

if (urlList.length === 0) {
  console.log('indexnow: no new, changed or removed public URLs');
  process.exit(0);
}

if (dryRun) {
  console.log(`indexnow: would submit ${urlList.length} URL(s) to ${ENDPOINT}`);
  for (const url of urlList) console.log(`  ${url}`);
  process.exit(0);
}

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key, keyLocation, urlList }),
});

const body = await response.text();
if (response.status !== 200 && response.status !== 202) {
  fail(`submission failed with HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`);
}

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.writeFileSync(
  STATE_FILE,
  `${JSON.stringify({ submittedAt: new Date().toISOString(), keyLocation, urls: current }, null, 2)}\n`,
  'utf8',
);

console.log(`indexnow: submitted ${urlList.length} URL(s); HTTP ${response.status}`);
for (const url of urlList) console.log(`  ${url}`);
