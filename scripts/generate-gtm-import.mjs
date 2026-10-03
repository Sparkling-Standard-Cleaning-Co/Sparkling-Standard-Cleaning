// GTM import artifact generator — builds the importable Google Tag Manager
// container files that deliver the website's fixed analytics events into the
// owner's existing GA4 property.
//
//   node scripts/generate-gtm-import.mjs          write the import files
//   node scripts/generate-gtm-import.mjs --check  verify only (no writes)
//
// The website already emits these events through window.dataLayer after
// consent (src/lib/analytics/events.ts). GTM/GA4 only receive them once the
// matching custom-event triggers and GA4 event tags exist inside the
// container — that is exactly what these files create. No names, contact
// details, addresses, ZIPs or form content appear in any parameter: the
// payload keys are the allowlisted ones from the event taxonomy.
//
// The identifiers are owner-confirmed (2026-10-03). Never invent new ones:
//   GTM container  GTM-KSQ26HMG
//   GA4 measurement G-LG222LQRQ2

import fs from 'node:fs';
import path from 'node:path';

const CHECK_ONLY = new Set(process.argv.slice(2)).has('--check');

const GTM_PUBLIC_ID = 'GTM-KSQ26HMG';
const GA4_MEASUREMENT_ID = 'G-LG222LQRQ2';
const GOOGLE_TAG_NAME = 'Google Tag — Sparkling Standard GA4';
const INITIALIZATION_ALL_PAGES = '2147479573';
const OUT_DIR = path.join('docs', 'analytics', 'gtm-import');

// Fixed timestamp so regenerating the committed files never produces a diff.
const EXPORT_TIME = '2026-10-03 00:00:00';

// ── Event mapping — must match src/lib/analytics/events.ts exactly ────────────

const EVENTS = [
  { name: 'call_click', parameters: ['cta_slot'] },
  { name: 'text_click', parameters: ['cta_slot'] },
  { name: 'estimate_start', parameters: ['service_type'] },
  { name: 'estimate_step', parameters: ['step', 'service_type'] },
  { name: 'estimate_complete', parameters: ['service_type', 'outcome'] },
  { name: 'cleaning_request_submit', parameters: ['service_type', 'journey'] },
  { name: 'commercial_quote_start', parameters: [] },
  { name: 'commercial_quote_submit', parameters: ['facility_type'] },
  { name: 'str_request_start', parameters: [] },
  { name: 'str_request_submit', parameters: [] },
  { name: 'booking_request', parameters: ['service_type'] },
  { name: 'review_link_click', parameters: ['platform'] },
];

/** Every dataLayer key a tag may forward — the allowlisted payload keys. */
const DATA_LAYER_KEYS = [...new Set(EVENTS.flatMap((event) => event.parameters))];

// ── Entity builders ───────────────────────────────────────────────────────────

function dataLayerVariable(key, variableId) {
  return {
    accountId: '0',
    containerId: '0',
    variableId: String(variableId),
    name: `DLV - ${key}`,
    type: 'v',
    parameter: [
      { type: 'INTEGER', key: 'dataLayerVersion', value: '2' },
      { type: 'BOOLEAN', key: 'setDefaultValue', value: 'false' },
      { type: 'TEMPLATE', key: 'name', value: key },
    ],
    fingerprint: '0',
  };
}

function customEventTrigger(eventName, triggerId) {
  return {
    accountId: '0',
    containerId: '0',
    triggerId: String(triggerId),
    name: `CE - ${eventName}`,
    type: 'CUSTOM_EVENT',
    customEventFilter: [
      {
        type: 'EQUALS',
        parameter: [
          { type: 'TEMPLATE', key: 'arg0', value: '{{_event}}' },
          { type: 'TEMPLATE', key: 'arg1', value: eventName },
        ],
      },
    ],
    fingerprint: '0',
  };
}

function ga4EventTag(event, triggerId, tagId) {
  const parameters = [
    { type: 'BOOLEAN', key: 'sendEcommerceData', value: 'false' },
    { type: 'TEMPLATE', key: 'eventName', value: event.name },
  ];
  if (event.parameters.length > 0) {
    parameters.push({
      type: 'LIST',
      key: 'eventParameters',
      list: event.parameters.map((key) => ({
        type: 'MAP',
        map: [
          { type: 'TEMPLATE', key: 'name', value: key },
          { type: 'TEMPLATE', key: 'value', value: `{{DLV - ${key}}}` },
        ],
      })),
    });
  }
  parameters.push({
    type: 'TEMPLATE',
    key: 'measurementIdOverride',
    value: GA4_MEASUREMENT_ID,
  });
  return {
    accountId: '0',
    containerId: '0',
    tagId: String(tagId),
    name: `GA4 - Event - ${event.name}`,
    type: 'gaawe',
    parameter: parameters,
    firingTriggerId: [String(triggerId)],
    tagFiringOption: 'ONCE_PER_EVENT',
    monitoringMetadata: { type: 'MAP' },
    consentSettings: { consentStatus: 'NOT_SET' },
    fingerprint: '0',
  };
}

function googleTag(tagId) {
  return {
    accountId: '0',
    containerId: '0',
    tagId: String(tagId),
    name: GOOGLE_TAG_NAME,
    type: 'googtag',
    parameter: [{ type: 'TEMPLATE', key: 'tagId', value: GA4_MEASUREMENT_ID }],
    firingTriggerId: [INITIALIZATION_ALL_PAGES],
    tagFiringOption: 'ONCE_PER_EVENT',
    monitoringMetadata: { type: 'MAP' },
    consentSettings: { consentStatus: 'NOT_SET' },
    fingerprint: '0',
  };
}

function containerVersion(name, { includeGoogleTag }) {
  const variables = DATA_LAYER_KEYS.map((key, index) => dataLayerVariable(key, index + 1));
  const triggers = EVENTS.map((event, index) => customEventTrigger(event.name, index + 1));
  const tagOffset = includeGoogleTag ? 1 : 0;
  const tags = EVENTS.map((event, index) => ga4EventTag(event, index + 1, index + 1 + tagOffset));
  if (includeGoogleTag) tags.unshift(googleTag(1));
  return {
    path: 'accounts/0/containers/0/versions/0',
    accountId: '0',
    containerId: '0',
    containerVersionId: '0',
    name,
    description:
      'Generated by scripts/generate-gtm-import.mjs — GA4 tracking for the fixed website event taxonomy. Do not edit by hand.',
    container: {
      path: 'accounts/0/containers/0',
      accountId: '0',
      containerId: '0',
      name: 'Sparkling Standard Cleaning Co.',
      publicId: GTM_PUBLIC_ID,
      usageContext: ['WEB'],
      fingerprint: '0',
      tagManagerUrl: '',
    },
    tag: tags,
    trigger: triggers,
    variable: variables,
    fingerprint: '0',
  };
}

function artifact({ includeGoogleTag, name }) {
  return {
    exportFormatVersion: 2,
    exportTime: EXPORT_TIME,
    containerVersion: containerVersion(name, { includeGoogleTag }),
  };
}

// ── Write / verify ────────────────────────────────────────────────────────────

const artifacts = [
  {
    file: path.join(OUT_DIR, 'gtm-ga4-full-setup.json'),
    name: 'Sparkling Standard — GA4 full setup',
    includeGoogleTag: true,
  },
  {
    file: path.join(OUT_DIR, 'gtm-ga4-events-only.json'),
    name: 'Sparkling Standard — GA4 events only',
    includeGoogleTag: false,
  },
];

let failures = 0;
for (const definition of artifacts) {
  const expected = `${JSON.stringify(
    artifact({ includeGoogleTag: definition.includeGoogleTag, name: definition.name }),
    null,
    2,
  )}\n`;
  if (CHECK_ONLY) {
    const actual = fs.existsSync(definition.file)
      ? fs.readFileSync(definition.file, 'utf8')
      : null;
    if (actual !== expected) {
      console.error(`GTM IMPORT DRIFT: ${definition.file} is missing or out of date.`);
      console.error('Run: npm run analytics:gtm');
      failures += 1;
    } else {
      console.log(`✓ ${definition.file}`);
    }
    continue;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(definition.file, expected, 'utf8');
  const written = fs.readFileSync(definition.file, 'utf8');
  if (written !== expected) {
    console.error(`GTM IMPORT WRITE FAILED: ${definition.file}`);
    failures += 1;
  } else {
    console.log(`✓ wrote ${definition.file}`);
  }
}

if (failures > 0) process.exit(1);
