// GTM import artifact tests — the generated container files must stay a
// faithful, PII-free projection of the fixed website event taxonomy.
// Run with: npm test (type-stripped TS).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

interface GtmTag {
  name: string;
  type: string;
  parameter: Array<{ key: string; value?: string; list?: Array<{ map: Array<{ key: string; value: string }> }> }>;
  firingTriggerId?: string[];
}

interface GtmTrigger {
  name: string;
  type: string;
  customEventFilter?: Array<{ parameter: Array<{ key: string; value: string }> }>;
}

interface GtmVariable {
  name: string;
  type: string;
  parameter: Array<{ key: string; value: string }>;
}

interface GtmContainerVersion {
  container: { publicId: string };
  tag: GtmTag[];
  trigger: GtmTrigger[];
  variable: GtmVariable[];
}

interface GtmArtifact {
  exportFormatVersion: number;
  containerVersion: GtmContainerVersion;
}

function readTaxonomy(): { names: string[]; params: Map<string, string[]> } {
  const source = fs.readFileSync('src/lib/analytics/events.ts', 'utf8');

  const union = source.match(/export type AnalyticsEventName =([\s\S]*?);/);
  assert.ok(union, 'event-name union found');
  const names = [...union[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

  const payloads = source.match(/export interface EventPayloads \{([\s\S]*?)\n\}/);
  assert.ok(payloads, 'payload interface found');
  const params = new Map<string, string[]>();
  for (const line of payloads[1].split('\n')) {
    const match = line.match(/^\s{2}([a-z_]+):\s*(.*)$/);
    if (!match) continue;
    const keys = match[2].startsWith('Record<')
      ? []
      : [...match[2].matchAll(/([a-z_]+)\??:/g)].map((param) => param[1]);
    params.set(match[1], keys);
  }
  return { names, params };
}

function readArtifact(file: string): GtmArtifact {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as GtmArtifact;
}

function tagParameters(tag: GtmTag): string[] {
  const table = tag.parameter.find((parameter) => parameter.key === 'eventParameters');
  if (!table?.list) return [];
  return table.list.map((row) => row.map.find((entry) => entry.key === 'name')?.value ?? '');
}

const { names, params } = readTaxonomy();
const fullSetup = readArtifact('docs/analytics/gtm-import/gtm-ga4-full-setup.json');
const eventsOnly = readArtifact('docs/analytics/gtm-import/gtm-ga4-events-only.json');

test('the taxonomy exposes the expected twelve events', () => {
  assert.equal(names.length, 12);
  assert.deepEqual(
    names,
    [
      'call_click',
      'text_click',
      'estimate_start',
      'estimate_step',
      'estimate_complete',
      'cleaning_request_submit',
      'commercial_quote_start',
      'commercial_quote_submit',
      'str_request_start',
      'str_request_submit',
      'booking_request',
      'review_link_click',
    ],
  );
});

test('every event has an exact-match custom-event trigger', () => {
  for (const artifact of [fullSetup, eventsOnly]) {
    const triggerNames = artifact.containerVersion.trigger.map((trigger) => trigger.name);
    assert.deepEqual(triggerNames, names.map((name) => `CE - ${name}`));
    for (const trigger of artifact.containerVersion.trigger) {
      assert.equal(trigger.type, 'CUSTOM_EVENT');
      const condition = trigger.customEventFilter?.[0]?.parameter ?? [];
      assert.equal(condition[0]?.value, '{{_event}}');
      assert.equal(condition[1]?.value, trigger.name.replace('CE - ', ''));
    }
  }
});

test('every event has a GA4 event tag whose parameters match the allowlist exactly', () => {
  for (const artifact of [fullSetup, eventsOnly]) {
    const eventTags = artifact.containerVersion.tag.filter((tag) => tag.type === 'gaawe');
    assert.deepEqual(
      eventTags.map((tag) => tag.name),
      names.map((name) => `GA4 - Event - ${name}`),
    );
    for (const tag of eventTags) {
      const eventName = tag.name.replace('GA4 - Event - ', '');
      assert.equal(tag.parameter.find((parameter) => parameter.key === 'eventName')?.value, eventName);
      assert.equal(tag.parameter.find((parameter) => parameter.key === 'measurementIdOverride')?.value, 'G-LG222LQRQ2');
      assert.deepEqual(tagParameters(tag), params.get(eventName), `parameters for ${eventName}`);
      assert.equal(tag.firingTriggerId?.length, 1);
    }
  }
});

test('every forwarded parameter has a matching data layer variable', () => {
  for (const artifact of [fullSetup, eventsOnly]) {
    const expected = [...new Set([...params.values()].flat())].map((key) => `DLV - ${key}`);
    assert.deepEqual(
      artifact.containerVersion.variable.map((variable) => variable.name),
      expected,
    );
    for (const variable of artifact.containerVersion.variable) {
      assert.equal(variable.type, 'v');
      assert.equal(variable.parameter.find((parameter) => parameter.key === 'dataLayerVersion')?.value, '2');
      assert.equal(
        variable.parameter.find((parameter) => parameter.key === 'name')?.value,
        variable.name.replace('DLV - ', ''),
      );
    }
  }
});

test('the full setup adds exactly one Google tag on Initialization', () => {
  const googleTags = fullSetup.containerVersion.tag.filter((tag) => tag.type === 'googtag');
  assert.equal(googleTags.length, 1);
  assert.equal(googleTags[0]?.parameter.find((parameter) => parameter.key === 'tagId')?.value, 'G-LG222LQRQ2');
  assert.deepEqual(googleTags[0]?.firingTriggerId, ['2147479573']);
  assert.equal(fullSetup.containerVersion.tag.length, names.length + 1);
  assert.equal(eventsOnly.containerVersion.tag.filter((tag) => tag.type === 'googtag').length, 0);
  assert.equal(eventsOnly.containerVersion.tag.length, names.length);
});

test('both artifacts target the owner container and never carry customer data', () => {
  const allowlist = new Set([...params.values()].flat());
  for (const artifact of [fullSetup, eventsOnly]) {
    assert.equal(artifact.exportFormatVersion, 2);
    assert.equal(artifact.containerVersion.container.publicId, 'GTM-KSQ26HMG');
    const forwarded = artifact.containerVersion.tag
      .filter((tag) => tag.type === 'gaawe')
      .flatMap((tag) => tagParameters(tag));
    for (const key of forwarded) {
      assert.ok(allowlist.has(key), `parameter ${key} is on the allowlist`);
    }
  }
});
