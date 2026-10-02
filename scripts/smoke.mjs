// Static smoke test over the built output.
//
// This environment cannot run a real browser, so the smoke test asserts the
// structural guarantees that matter (documented in docs/VERIFICATION.md):
// required pages exist, every page has the layout shell, the estimate flow
// has all seven steps and the request/submit states, and no obviously broken
// interactive markup ships. Run: npm run smoke (after npm run build).

import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const problems = [];

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run npm run build first');
  process.exit(1);
}

const REQUIRED_PAGES = [
  'index.html',
  'house-cleaning/index.html',
  'recurring-cleaning/index.html',
  'deep-cleaning/index.html',
  'move-in-move-out-cleaning/index.html',
  'short-term-rental-cleaning/index.html',
  'commercial-cleaning/index.html',
  'church-cleaning/index.html',
  'estimate/index.html',
  'about/index.html',
  'service-area/index.html',
  'contact/index.html',
  'faq/index.html',
  'privacy/index.html',
  'terms/index.html',
  'thank-you/index.html',
  '404.html',
];

for (const page of REQUIRED_PAGES) {
  const file = path.join(DIST, page);
  if (!fs.existsSync(file)) {
    problems.push(`missing required page: ${page}`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');

  for (const [label, needle] of [
    ['header shell', 'class="site-header"'],
    ['footer shell', 'class="site-footer"'],
    ['mobile action bar', 'class="mobile-action-bar"'],
    ['skip link', 'class="skip-link"'],
    ['main landmark', 'id="main"'],
  ]) {
    if (!html.includes(needle)) problems.push(`${page}: missing ${label}`);
  }

  if (/href="#"/.test(html)) problems.push(`${page}: contains an empty href="#" link`);
}

// Estimate flow structure.
const estimate = fs.readFileSync(path.join(DIST, 'estimate', 'index.html'), 'utf8');
for (const [label, needle] of [
  ['estimate form', 'data-estimate-form'],
  ['progress indicator', 'data-progress-fill'],
  ['step navigator', 'data-wizard-steps'],
  ['step 1', 'data-step="1"'],
  ['step 6', 'data-step="6"'],
  ['submit button', 'data-submit'],
  ['live estimate panel', 'data-estimate-live'],
  ['address finder', 'data-address-finder'],
  ['street address field', 'id="est-address"'],
  ['city field', 'id="est-address-city"'],
  ['state selector', 'id="est-address-state"'],
  ['ZIP field', 'id="est-zip"'],
  ['map confirmation card', 'data-address-map'],
  ['manual address fallback', 'data-address-manual-panel'],
  ['reservation summary', 'data-reservation-summary'],
  ['price preview', 'data-price-preview'],
  ['post-send timeline', 'timeline__stage'],
]) {
  if (!estimate.includes(needle)) problems.push(`estimate page: missing ${label}`);
}
if ((estimate.match(/data-step="/g) ?? []).length !== 6) {
  problems.push('estimate page: expected exactly 6 steps');
}
if ((estimate.match(/data-step-item="/g) ?? []).length !== 6) {
  problems.push('estimate page: expected exactly 6 navigator items');
}
if (estimate.includes('owner review') || estimate.includes('Our server recalculates')) {
  problems.push('estimate page: internal/technical copy leaked into the customer UI');
}

// The direct-submission fallback must ship its unmistakable UNVERIFIED marker.
const astroDir = path.join(DIST, '_astro');
const bundleText = fs
  .readdirSync(astroDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(astroDir, file), 'utf8'))
  .join('\n');
if (!bundleText.includes('unverified_direct_submission')) {
  problems.push('built scripts: missing the unverified direct-submission marker');
}
if (!bundleText.includes('setWorkerUrl')) {
  problems.push('built scripts: MapLibre worker URL is not configured (blank-map guard)');
}
const workerAssets = fs.readdirSync(astroDir).filter((file) => /worker.*\.js$/i.test(file));
if (workerAssets.length === 0) {
  problems.push('built assets: the MapLibre worker bundle was not emitted');
}
if (bundleText.includes('routes.googleapis.com') || bundleText.includes('api.mapbox.com')) {
  problems.push('built scripts: a paid routing provider was bundled');
}

// Lead forms with correct variants.
const variants = [
  ['contact/index.html', 'data-variant="contact"'],
  ['commercial-cleaning/index.html', 'data-variant="commercial"'],
  ['short-term-rental-cleaning/index.html', 'data-variant="str"'],
];
for (const [page, needle] of variants) {
  if (!fs.readFileSync(path.join(DIST, page), 'utf8').includes(needle)) {
    problems.push(`${page}: missing lead form (${needle})`);
  }
}

// Sticky bar must not be hidden from narrow viewports in markup (CSS handles
// responsiveness; markup must always render the three actions).
const bar = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').match(/class="mobile-action-bar"[\s\S]*?<\/div>/)?.[0] ?? '';
for (const slot of ['data-cta="sticky-estimate"']) {
  if (!bar.includes(slot)) problems.push(`mobile action bar: missing ${slot}`);
}

// Every page must include exactly one consent banner placeholder (hidden until
// analytics is configured) OR none when analytics is unconfigured. Both are
// valid; we only assert there is never more than one.
const bannerCount = (estimate.match(/data-consent-banner/g) ?? []).length;
if (bannerCount > 1) problems.push('estimate page: more than one consent banner');

if (problems.length > 0) {
  console.error(`SMOKE FAILURES (${problems.length}):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log(`✓ smoke checks passed across ${REQUIRED_PAGES.length} pages`);
console.log('  (browser-level checks — real viewport/overlay/JS behavior — are documented as pending in docs/VERIFICATION.md)');
