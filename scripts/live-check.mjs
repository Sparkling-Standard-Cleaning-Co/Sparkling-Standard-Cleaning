// Live production checks — repeatable, dependency-free.
//
// Verifies reachability and configuration signals on the deployed site without
// sending any email. Run after a deploy:
//
//   node scripts/live-check.mjs [base-url]
//
// Exit code 0 = every reachability check passed. Configuration warnings
// (missing Web3Forms/Travel settings) are reported separately and do not fail
// the run — they are owner actions, not outages.

const BASE = (process.argv[2] ?? 'https://sparkling-standard.com').replace(/\/+$/, '');

const failures = [];
const warnings = [];
const notes = [];

async function get(path, expectStatus = 200) {
  const response = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  if (response.status !== expectStatus) {
    failures.push(`GET ${path} → ${response.status} (expected ${expectStatus})`);
  }
  return response;
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// 1. robots.txt
const robots = await (await get('/robots.txt')).text();
if (!/Allow:\s*\//.test(robots)) failures.push('robots.txt does not allow crawling');
if (!/Sitemap:\s*https:\/\//.test(robots)) failures.push('robots.txt is missing the sitemap URL');
if (/Disallow:\s*\/\s*$/m.test(robots) && !/Allow:\s*\//.test(robots)) {
  warnings.push('robots.txt contains Disallow: / — preview mode may be active');
}

// 2. Sitemap
await get('/sitemap-index.xml');

// 3. Homepage + canonical + robots meta
const home = await get('/');
const html = await home.text();
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
if (canonical !== `${BASE}/`) failures.push(`homepage canonical is "${canonical}" (expected "${BASE}/")`);
const metaRobots = html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? '';
if (metaRobots.includes('noindex')) warnings.push(`homepage meta robots is "${metaRobots}" — indexing may be intentionally off`);
if (!metaRobots.includes('index')) warnings.push(`homepage meta robots is "${metaRobots}"`);

// 4. Key pages reachable
for (const path of ['/estimate/', '/contact/', '/short-term-rental-cleaning/', '/commercial-cleaning/']) {
  await get(path);
}

// 5. Travel function: reachable, and configuration state reported honestly.
const travel = await post('/api/travel', { zip: '32503' });
if (travel.status === 404) failures.push('/api/travel is not deployed (404)');
else if (travel.status === 503 && travel.data?.error === 'origin_not_configured') {
  warnings.push('travel: TRAVEL_ORIGIN is not configured (estimator runs in offline zone mode)');
} else if (travel.status === 200) {
  notes.push(`travel: configured (method=${travel.data?.method}, gas=${travel.data?.gasPriceSource})`);
} else {
  warnings.push(`travel: unexpected status ${travel.status} ${JSON.stringify(travel.data)}`);
}

// 6. Lead function: reachable and validating. Never send a valid payload —
//    the script must not email the owner — unless the operator explicitly opts
//    in with --probe-lead (used for authorized deployment tests).
const lead = await post('/api/lead', {});
if (lead.status === 404) failures.push('/api/lead is not deployed (404)');
else if (lead.status === 400) {
  notes.push('lead: deployed and validating input (delivery check: --probe-lead or the owner authorized live test)');
}
else if (lead.status === 503) warnings.push('lead: WEB3FORMS_ACCESS_KEY is not configured — no form can deliver yet');
else warnings.push(`lead: unexpected status ${lead.status} ${JSON.stringify(lead.data)}`);

if (process.argv.includes('--probe-lead')) {
  const probe = await post('/api/lead', {
    subject: '[TEST] live-check probe — please ignore',
    fields: {
      name: 'live-check probe (automated)',
      email: 'owner@sparkling-standard.com',
      message: 'Automated deployment probe. Please ignore.',
      form_variant: 'live_check_probe',
    },
  });
  if (probe.status === 200) notes.push('lead probe: provider accepted a marked test (confirm inbox delivery manually)');
  else if (probe.status === 503) warnings.push('lead probe: not configured — provider was not contacted');
  else warnings.push(`lead probe: status ${probe.status} ${JSON.stringify(probe.data)}`);
}

// 7. Report
console.log(`live-check: ${BASE}`);
for (const note of notes) console.log(`  ✓ ${note}`);
for (const warning of warnings) console.log(`  ! ${warning}`);
for (const failure of failures) console.log(`  ✗ ${failure}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} live check(s) FAILED`);
  process.exit(1);
}
console.log(`\n✓ every live reachability check passed (${warnings.length} configuration warning(s))`);
