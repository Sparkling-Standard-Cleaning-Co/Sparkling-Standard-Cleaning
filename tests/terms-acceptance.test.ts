// Transactional terms acceptance: the server, not the browser, decides whether
// the current terms were accepted and records the evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as leadPost } from '../functions/api/lead.ts';
import { onRequestPost as checkoutPost } from '../functions/api/estimate-checkout.ts';
import { legalTerms } from '../src/config/legal.ts';

const jsonRequest = (body: unknown) =>
  new Request('https://example.test/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function withFetch<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response({ success: true })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

class FakeBucket {
  readonly puts = new Map<string, string>();
  async put(key: string, value: string): Promise<unknown> {
    this.puts.set(key, value);
    return {};
  }
}

const baseFields = (overrides: Record<string, string> = {}) => ({
  request_type: 'residential_estimate',
  service_type: 'standard',
  property_type: 'house',
  square_feet: '1600',
  bedrooms: '3',
  full_baths: '2',
  half_baths: '0',
  frequency: 'one_time',
  condition: 'maintained',
  last_cleaned: 'within_month',
  pets: 'none',
  service_address: '100 S Baylen St',
  address_city: 'Pensacola',
  address_state: 'FL',
  zip: '32502',
  name: 'Terms Test',
  phone: '8500000000',
  email: 'terms@example.test',
  ...overrides,
});

test('a transactional request without acceptance is rejected', async () => {
  const result = await withFetch(() =>
    leadPost({
      request: jsonRequest({ subject: 'Estimate', fields: baseFields() }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy' },
    } as never),
  );
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { ok: false, error: 'terms_required' });
});

test('an outdated accepted version is rejected', async () => {
  const result = await withFetch(() =>
    leadPost({
      request: jsonRequest({
        subject: 'Estimate',
        fields: baseFields({ terms_accepted: 'yes', terms_version: '2020-01-01.old' }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy' },
    } as never),
  );
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { ok: false, error: 'terms_outdated' });
});

test('the current acceptance is server-stamped and stored privately', async () => {
  const bucket = new FakeBucket();
  const result = await withFetch(() =>
    leadPost({
      request: jsonRequest({
        subject: 'Estimate',
        fields: baseFields({ terms_accepted: 'yes', terms_version: legalTerms.termsVersion }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy', PHOTOS_BUCKET: bucket },
    } as never),
  );
  assert.equal(result.status, 200);
  assert.equal(bucket.puts.size, 1);
  const [key, value] = [...bucket.puts.entries()][0]!;
  assert.match(key, /^legal\/acceptances\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.json$/);
  const record = JSON.parse(value) as Record<string, string>;
  assert.equal(record.termsVersion, legalTerms.termsVersion);
  assert.equal(record.policyVersion, legalTerms.policyVersion);
  assert.equal(record.email, 'terms@example.test');
  assert.match(record.acceptedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a contact message is not blocked by transactional terms', async () => {
  const result = await withFetch(() =>
    leadPost({
      request: jsonRequest({
        subject: 'Question',
        fields: { request_type: 'contact', phone: '8500000000', message: 'Hello' },
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy' },
    } as never),
  );
  assert.equal(result.status, 200);
});

test('checkout refuses fields without the current acceptance', async () => {
  const result = await checkoutPost({
    request: jsonRequest({
      fields: { request_type: 'reservation_request', quoted_price: '250', email: 'terms@example.test' },
      returnPath: '/estimate/residential/',
    }),
    env: {},
  } as never);
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { ok: false, error: 'terms_required' });
});
