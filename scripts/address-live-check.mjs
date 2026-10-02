// Live address pipeline check — runs the REAL /api/geocode function against the
// live provider using the local .env key. Read-only and free (suggestions are
// unbilled to the provider's daily allowance; the safety gate refuses to run
// when the account holds prepaid credit).
//
// Usage: npm run address:check
//
// Only public or clearly synthetic addresses are used. The key is never
// printed, and no address entered here identifies a customer.

import fs from 'node:fs';
import { onRequestPost } from '../functions/api/geocode.ts';

function loadDotEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

const dotenv = loadDotEnv('.env');
const key = (dotenv.ROUTES_API_KEY || dotenv.MAPMAP_API_KEY || '').trim();
const base = (dotenv.MAPMAP_BASE || 'https://api.mapmap.ai').replace(/\/+$/, '');
if (!key) {
  console.error('Missing ROUTES_API_KEY in .env. Nothing was sent.');
  process.exit(1);
}

// Safety gate: quota-free key status, verified only, zero prepaid credit.
const statusResponse = await fetch(`${base}/v1/keys/self`, {
  headers: { Authorization: `Bearer ${key}` },
}).catch(() => null);
const status = statusResponse ? await statusResponse.json().catch(() => ({})) : {};
if (!statusResponse || statusResponse.status !== 200 || status.state !== 'verified' || Number(status.credits_pence ?? 0) !== 0) {
  console.error('ABORT: key not verified or prepaid credit present. Nothing was sent; no charge is possible.');
  process.exit(1);
}

let ipCounter = 0;
async function suggest(fields) {
  const request = new Request('https://example.test/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.10.0.${++ipCounter}` },
    body: JSON.stringify({ action: 'suggest', ...fields }),
  });
  const response = await onRequestPost({ request, env: { MAPMAP_API_KEY: key } });
  return { status: response.status, data: await response.json() };
}

async function resolve(query) {
  const request = new Request('https://example.test/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.10.1.${++ipCounter}` },
    body: JSON.stringify({ action: 'resolve', query }),
  });
  const response = await onRequestPost({ request, env: { MAPMAP_API_KEY: key } });
  return { status: response.status, data: await response.json() };
}

const failures = [];
function check(condition, message) {
  console.log(`  ${condition ? '✓' : '✗'} ${message}`);
  if (!condition) failures.push(message);
}
const florida = (label) => /, fl\b|florida/i.test(label);
const alabama = (label) => /, al\b|alabama/i.test(label);

console.log('1. Partial street + city (public Pensacola street)');
{
  const { status, data } = await suggest({ query: '100 S Bayl, Pensacola', street: '100 S Bayl', city: 'Pensacola', state: 'FL', zip: '' });
  check(status === 200 && data.ok === true, `HTTP ${status} ok`);
  const rows = data.suggestions ?? [];
  check(rows.length > 0, `returned ${rows.length} suggestion(s)`);
  check(rows.every((row) => florida(row.label)), 'every suggestion is in Florida');
  check(rows.every((row) => !/georgia|,\s*ga\b/i.test(row.label)), 'no Georgia result leaked through');
  for (const row of rows.slice(0, 3)) console.log(`      - ${row.label}`);
}

console.log('2. Abbreviated suffix vs full suffix (public Atmore, AL street)');
for (const street of ['201 E Louisville Ave', '201 E Louisville Avenue']) {
  const { status, data } = await suggest({ query: `${street}, Atmore`, street, city: 'Atmore', state: 'AL', zip: '36502' });
  const rows = data.suggestions ?? [];
  check(status === 200 && rows.length > 0, `"${street}" returned ${rows.length} Alabama suggestion(s)`);
  check(rows.every((row) => alabama(row.label)), `"${street}" results are all Alabama`);
}

console.log('3. Florida junk-resistance (no city supplied)');
{
  const { status, data } = await suggest({ query: '100 Main St', street: '100 Main St', city: '', state: 'FL', zip: '' });
  const rows = data.suggestions ?? [];
  check(status === 200, `HTTP ${status} ok`);
  check(rows.every((row) => !/georgia|,\s*ga\b/i.test(row.label)), `no Georgia result among ${rows.length} row(s)`);
  check(rows.every((row) => florida(row.label)), 'every returned row is Florida (or none)');
}

console.log('4. Exact public address resolution (Census/MapMap)');
{
  const { status, data } = await resolve('100 S Baylen St, Pensacola, FL, 32502');
  check(status === 200 && data.ok === true, `HTTP ${status} ok`);
  check(data.result?.precise === true, 'result is precise (house number present)');
  check(typeof data.result?.lat === 'number' && typeof data.result?.lng === 'number', 'coordinates present');
  if (data.result) console.log(`      - ${data.result.label} (${data.result.source})`);
}

console.log('5. Honest failure for a synthetic, unfindable address');
{
  const { status, data } = await suggest({ query: '99999 Nonexistent Hollow Rd, Molino', street: '99999 Nonexistent Hollow Rd', city: 'Molino', state: 'FL', zip: '32577' });
  check(status === 200, `HTTP ${status} ok`);
  const rows = data.suggestions ?? [];
  check(rows.every((row) => !/nonexistent/i.test(row.label)), 'no fabricated "Nonexistent Hollow" suggestion');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} live check(s) FAILED.`);
  process.exit(1);
}
console.log('\n✓ Live address pipeline behaves as expected. Mocks are not the only evidence.');
