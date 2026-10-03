// Attribution regression tests — first-touch preservation, meaningful
// latest-touch updates, and the rule that internal navigation, refreshes and
// direct views never erase campaign context. Run with: npm test.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { attributionFields, captureAttribution, getAttribution } from '../src/lib/attribution.ts';

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

interface FakeWindow {
  location: { href: string; search: string; pathname: string; origin: string };
  localStorage: MemoryStorage;
}

let storage: MemoryStorage;

function visit(url: string, referrer = ''): void {
  const parsed = new URL(url);
  const globals = globalThis as unknown as { window: FakeWindow; document: { referrer: string } };
  globals.window = {
    location: {
      href: url,
      search: parsed.search,
      pathname: parsed.pathname,
      origin: parsed.origin,
    },
    localStorage: storage,
  };
  globals.document = { referrer };
  captureAttribution();
}

const SITE = 'https://sparkling-standard.com';
const INTERNAL_REFERRER = 'https://sparkling-standard.com/recurring-cleaning/';

beforeEach(() => {
  storage = createStorage();
});

test('a Facebook campaign arrival survives internal navigation to the estimator', () => {
  visit(`${SITE}/recurring-cleaning/?utm_source=facebook&utm_medium=organic_social&utm_campaign=recurring&utm_content=feed`);
  visit(`${SITE}/estimate/`, INTERNAL_REFERRER);

  const { first, latest } = getAttribution();
  assert.equal(first?.source, 'facebook');
  assert.equal(latest?.source, 'facebook');
  assert.equal(latest?.medium, 'organic_social');
  assert.equal(latest?.campaign, 'recurring');
  assert.equal(latest?.content, 'feed');
  assert.equal(latest?.landingPage, '/recurring-cleaning/', 'the campaign landing page is kept');
  assert.equal(latest?.referrerOrigin, undefined, 'same-domain navigation is not a referral');

  const fields = attributionFields();
  assert.equal(fields.first_utm_source, 'facebook');
  assert.equal(fields.latest_utm_source, 'facebook');
  assert.equal(fields.latest_utm_campaign, 'recurring');
  assert.equal(fields.landing_page, '/recurring-cleaning/');
  assert.equal(fields.referrer_origin, undefined);
});

test('multiple internal page visits after a Nextdoor arrival never erase it', () => {
  visit(`${SITE}/?utm_source=nextdoor&utm_medium=organic_social&utm_campaign=neighborhood`);
  visit(`${SITE}/house-cleaning/`, `${SITE}/`);
  visit(`${SITE}/estimate/`, `${SITE}/house-cleaning/`);
  visit(`${SITE}/contact/`, `${SITE}/estimate/`);

  const { first, latest } = getAttribution();
  assert.equal(first?.source, 'nextdoor');
  assert.equal(latest?.source, 'nextdoor');
  assert.equal(latest?.landingPage, '/', 'the original campaign landing page is kept');
});

test('a genuinely new campaign updates latest-touch but never first-touch', () => {
  visit(`${SITE}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=facebook_page`);
  visit(`${SITE}/estimate/`, `${SITE}/`);
  visit(`${SITE}/?utm_source=nextdoor&utm_medium=organic_social&utm_campaign=neighborhood&utm_content=sponsored`);

  const { first, latest } = getAttribution();
  assert.equal(first?.source, 'facebook', 'first-touch is preserved');
  assert.equal(first?.campaign, 'facebook_page');
  assert.equal(latest?.source, 'nextdoor', 'the new campaign becomes latest-touch');
  assert.equal(latest?.campaign, 'neighborhood');
  assert.equal(latest?.content, 'sponsored');
  assert.equal(latest?.landingPage, '/');

  const fields = attributionFields();
  assert.equal(fields.first_utm_source, 'facebook');
  assert.equal(fields.latest_utm_source, 'nextdoor');
});

test('an ordinary direct visit seeds the record once but never overwrites it', () => {
  visit(`${SITE}/`);
  assert.equal(getAttribution().latest?.landingPage, '/');
  assert.equal(getAttribution().latest?.source, undefined);

  visit(`${SITE}/about/`);
  assert.equal(getAttribution().latest?.landingPage, '/', 'a later direct page view does not replace the record');

  visit(`${SITE}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=page`);
  visit(`${SITE}/contact/`);
  assert.equal(getAttribution().latest?.source, 'facebook', 'a direct view after a campaign preserves the campaign');
});

test('external referrals are recorded while no campaign exists; same-domain referrers never are', () => {
  visit(`${SITE}/house-cleaning/`, 'https://www.google.com/search');
  const referral = getAttribution().latest;
  assert.equal(referral?.referrerOrigin, 'https://www.google.com');
  assert.equal(referral?.landingPage, '/house-cleaning/');

  // Internal navigation with a same-domain referrer is not a new referral.
  visit(`${SITE}/estimate/`, `${SITE}/house-cleaning/`);
  assert.equal(getAttribution().latest?.referrerOrigin, 'https://www.google.com');
  assert.equal(getAttribution().latest?.landingPage, '/house-cleaning/');

  // A campaign still wins over a later referral-only touch, and the referral
  // is not allowed to erase it.
  visit(`${SITE}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=page`);
  visit(`${SITE}/about/`, 'https://www.bing.com/');
  assert.equal(getAttribution().latest?.source, 'facebook');
});

test('advertising click ids survive navigation and a later campaign', () => {
  visit(`${SITE}/?gclid=ads-click-123`);
  assert.equal(getAttribution().latest?.gclid, 'ads-click-123');

  visit(`${SITE}/estimate/`, `${SITE}/`);
  assert.equal(getAttribution().latest?.gclid, 'ads-click-123', 'internal navigation keeps the ad click');

  visit(`${SITE}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=page`);
  assert.equal(getAttribution().latest?.gclid, undefined, 'the latest touch is the campaign');
  const fields = attributionFields();
  assert.equal(fields.gclid, 'ads-click-123', 'the first-touch ad click still reaches the lead record');
  assert.equal(fields.latest_utm_source, 'facebook');
});

test('refreshing the identical campaign link does not rewrite the touch', () => {
  const campaign = `${SITE}/recurring-cleaning/?utm_source=facebook&utm_medium=organic_social&utm_campaign=recurring`;
  visit(campaign);
  const firstRead = getAttribution().latest;
  visit(campaign);
  assert.deepEqual(getAttribution().latest, firstRead);
});

test('long identifiers are clipped and malformed referrers are ignored', () => {
  const long = 'x'.repeat(500);
  visit(`${SITE}/?utm_source=${long}`, 'not a url');
  const latest = getAttribution().latest;
  assert.equal(latest?.source?.length, 200);
  assert.equal(latest?.referrerOrigin, undefined);
});
