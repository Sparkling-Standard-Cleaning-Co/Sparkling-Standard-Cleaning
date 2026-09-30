// Production environment validation (directive §79, §88).
//
// Run this before deploying to production: it refuses to bless a deployment
// while launch-critical facts are missing or placeholder values are present.
//
// Usage: npm run validate:production   (reads .env when present)

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

const blockers = [];
const warnings = [];

function requireValue(key, predicate, description) {
  const value = env[key];
  if (!value || !predicate(value)) blockers.push(`${key} — ${description}`);
}

requireValue(
  'PUBLIC_SITE_URL',
  (value) => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) && !value.includes('.invalid'),
  'final production domain (https, no placeholder)',
);
requireValue(
  'PUBLIC_BUSINESS_NAME',
  (value) => !/pending/i.test(value),
  'approved company name (PENDING placeholder not allowed)',
);
requireValue(
  'PUBLIC_BUSINESS_PHONE',
  (value) => value.replace(/\D/g, '').length >= 10,
  'public phone number',
);
requireValue('PUBLIC_BUSINESS_EMAIL', (value) => value.includes('@'), 'public email address');
requireValue(
  'PUBLIC_WEB3FORMS_ACCESS_KEY',
  (value) => value.length > 10,
  'form provider key (or reconfigure the forms adapter and update this check)',
);
requireValue(
  'TRAVEL_ORIGIN',
  (value) => /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value),
  'operating origin for the estimator ("lat,lng")',
);

if (env.PUBLIC_PREVIEW_MODE === 'true') {
  blockers.push('PUBLIC_PREVIEW_MODE — must NOT be true on production');
}
if (!env.PUBLIC_UMAMI_WEBSITE_ID && !env.PUBLIC_GTM_CONTAINER_ID) {
  warnings.push('No analytics IDs configured — analytics consent UI stays hidden (allowed, but launch checklist expects at least one).');
}
if (!env.TURNSTILE_SECRET_KEY && !env.PUBLIC_TURNSTILE_SITE_KEY) {
  warnings.push('Turnstile not configured — forms rely on honeypot + timing checks only.');
}
if (!env.EIA_API_KEY) {
  warnings.push('EIA_API_KEY missing — the estimator uses the configured reference gas price.');
}

// The owner-approved launch flag lives in source control on purpose: flipping
// it is a deliberate, reviewable act.
const businessSource = fs.readFileSync('src/config/business.ts', 'utf8');
if (!/productionApproved:\s*true/.test(businessSource)) {
  blockers.push('business.launch.productionApproved — still false in src/config/business.ts');
}

if (blockers.length > 0) {
  console.error('PRODUCTION VALIDATION FAILED — resolve every blocker first:');
  for (const blocker of blockers) console.error(` ✗ ${blocker}`);
  if (warnings.length > 0) {
    console.error('\nWarnings:');
    for (const warning of warnings) console.error(` ! ${warning}`);
  }
  console.error('\nSee docs/launch/OWNER-INPUT-REQUIRED.md and docs/DEPLOYMENT.md');
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn('Warnings (non-blocking):');
  for (const warning of warnings) console.warn(` ! ${warning}`);
}
console.log('✓ production environment validation passed');
