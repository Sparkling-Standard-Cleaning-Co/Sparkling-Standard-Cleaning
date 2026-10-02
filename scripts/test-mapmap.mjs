// Live MapMap verification — run with the provider key in the local .env.
//
// Usage: npm run mapmap:verify
//
// Reads ROUTES_API_KEY (or MAPMAP_API_KEY) and TRAVEL_ORIGIN from the local
// .env (git-ignored) or the process environment. NEVER prints the key or the
// private origin coordinates; prints only results. Read-only: it cannot spend
// money — MapMap refuses requests at quota instead of billing.
//
// Checks, in order:
//   1. Key status via GET /v1/keys/self (quota-free).
//   2. Address suggestions for a public Pensacola address.
//   3. Single-shot geocode (authoritative coordinates).
//   4. Census Geocoder fallback (free, no key).
//   5. Two real routes with distance and driving duration.

import fs from 'node:fs';

function loadDotEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

const env = { ...loadDotEnv('.env'), ...process.env };
const key = env.ROUTES_API_KEY?.trim() || env.MAPMAP_API_KEY?.trim() || '';
const origin = env.TRAVEL_ORIGIN?.trim() || '';
const base = (env.MAPMAP_BASE?.trim() || 'https://api.mapmap.ai').replace(/\/+$/, '');

if (!key || !origin) {
  console.error('Missing local configuration. Add these to .env (git-ignored):');
  if (!key) console.error('  ROUTES_API_KEY=<your MapMap key>');
  if (!origin) console.error('  TRAVEL_ORIGIN=<lat,lng>');
  console.error('Nothing was sent; no value is printed by this script.');
  process.exit(1);
}

const originParts = origin.split(',').map((part) => Number(part.trim()));
if (originParts.length !== 2 || originParts.some((part) => !Number.isFinite(part))) {
  console.error('TRAVEL_ORIGIN is not a valid "lat,lng" value.');
  process.exit(1);
}
const [originLat, originLng] = originParts;

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.log(`  ✗ ${message}`);
};

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// 1. Key status (quota-free).
console.log('1. Key status');
const before = await getJson(`${base}/v1/keys/self`, { Authorization: `Bearer ${key}` });
if (before.status !== 200) {
  fail(`key status returned HTTP ${before.status} (check the key and its state)`);
} else {
  const d = before.data;
  console.log(
    `  state=${d.state} quota=${d.monthly_quota} used=${d.used_this_month} remaining=${d.remaining} credits_pence=${d.credits_pence}`,
  );
  if (Number(d.credits_pence ?? 0) > 0) {
    console.log('  note: prepaid credit exists on this account; this script never tops up and never spends credit.');
  }
  if (d.state !== 'verified') {
    fail('key is not verified yet (confirm the email link to reach the free 50,000/month tier)');
  }
}

// 2. Address suggestions (public test address; first 5,000/day unbilled).
console.log('2. Address suggestions (Pensacola test address)');
const suggest = await getJson(
  `${base}/geocode/suggest?q=${encodeURIComponent('100 S Baylen St, Pensacola')}&limit=5&bias=-87.2169,30.4213`,
  { Authorization: `Bearer ${key}` },
);
if (suggest.status !== 200) {
  fail(`suggest returned HTTP ${suggest.status}`);
} else {
  const features = suggest.data?.features ?? [];
  console.log(`  suggestions: ${features.length}`);
  for (const feature of features.slice(0, 3)) {
    const p = feature.properties ?? {};
    const label = p.label ?? [p.name, p.street, p.city, p.state, p.postcode].filter(Boolean).join(', ');
    console.log(`    - ${label}`);
  }
  if (features.length === 0) fail('no suggestions returned for a known Pensacola address (coverage gap?)');
}

// 3. Single-shot geocode.
console.log('3. Authoritative geocode');
const geocode = await getJson(
  `${base}/geocode?q=${encodeURIComponent('100 S Baylen St, Pensacola, FL 32502')}&limit=1&country=us`,
  { Authorization: `Bearer ${key}` },
);
if (geocode.status !== 200) {
  fail(`geocode returned HTTP ${geocode.status}`);
} else {
  const feature = geocode.data?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  console.log(`  top match coordinates present: ${Array.isArray(coords) && coords.length === 2}`);
}

// 4. Census fallback (free, no key).
console.log('4. Census Geocoder fallback');
const censusUrl =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
  `?address=${encodeURIComponent('100 S Baylen St, Pensacola, FL 32502')}&benchmark=Public_AR_Current&format=json`;
const census = await fetch(censusUrl);
const censusData = await census.json().catch(() => ({}));
const censusMatch = censusData?.result?.addressMatches?.[0];
console.log(`  census match: ${Boolean(censusMatch)}`);
if (!censusMatch) fail('Census fallback returned no match for a known address');

// 5. Real routes with distance + duration (origin never printed).
const destinations = [
  { label: 'Cantonment-area address', lat: 30.61, lng: -87.34 },
  { label: 'Atmore, AL', lat: 31.02, lng: -87.49 },
];
console.log('5. Real routing (origin hidden)');
for (const destination of destinations) {
  const url = `${base}/route/v1/driving/${originLng},${originLat};${destination.lng},${destination.lat}?overview=false`;
  const route = await getJson(url, { Authorization: `Bearer ${key}` });
  const r = route.data?.routes?.[0];
  if (route.status !== 200 || !r || typeof r.distance !== 'number') {
    fail(`${destination.label}: HTTP ${route.status} (${route.data?.code ?? route.data?.title ?? 'no route'})`);
    continue;
  }
  const miles = (r.distance / 1609.344).toFixed(1);
  const minutes = typeof r.duration === 'number' ? Math.round(r.duration / 60) : null;
  console.log(`  ${destination.label}: ${miles} mi one way, ${minutes ?? '?'} min driving`);
  if (minutes === null) fail(`${destination.label}: provider returned no driving duration`);
}

// Quota impact.
const after = await getJson(`${base}/v1/keys/self`, { Authorization: `Bearer ${key}` });
if (after.status === 200) {
  console.log(`quota used this month after the run: ${after.data.used_this_month} (before: ${before.data?.used_this_month ?? '?'})`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED — see above. No charges are possible at quota.`);
  process.exit(1);
}
console.log('\n✓ MapMap verified for our endpoints, billing safety, and U.S. test routes.');
console.log('  Next: record the results, then enable the client address UI increment.');
