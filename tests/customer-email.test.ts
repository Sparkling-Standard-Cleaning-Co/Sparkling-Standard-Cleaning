// Customer confirmation delivery (Resend) — module tests. No real email is
// ever sent: global fetch is stubbed per test and always restored.
// Run with: npm test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CUSTOMER_EMAIL_BUSINESS,
  DEFAULT_CUSTOMER_EMAIL_FROM,
  DEFAULT_CUSTOMER_EMAIL_REPLY_TO,
  RESEND_ENDPOINT,
  describeCustomerEmailOutcome,
  sendCustomerConfirmation,
} from '../src/lib/forms/customer-email.ts';

const fields: Record<string, string> = {
  request_type: 'reservation_request',
  service_type: 'standard',
  frequency: 'biweekly',
  service_address: '100 S Baylen St',
  address_city: 'Pensacola',
  address_state: 'FL',
  zip: '32502',
  preferred_date: '2026-12-15',
  quoted_range: '$180–$220',
  quote_reference: 'SS-20261002-ABC123',
  name: 'Synthetic Customer',
  phone: '8500000000',
  email: 'synthetic@example.com',
};

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

async function withFetch<T>(
  stub: (url: string, init?: RequestInit) => Promise<Response>,
  run: (calls: CapturedCall[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return stub(String(input), init);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('the embedded business facts cannot drift from business.ts', () => {
  const source = fs.readFileSync('src/config/business.ts', 'utf8');
  assert.equal(CUSTOMER_EMAIL_BUSINESS.name, 'Sparkling Standard Cleaning Co.');
  assert.equal(CUSTOMER_EMAIL_BUSINESS.founder, 'Hayli');
  assert.equal(CUSTOMER_EMAIL_BUSINESS.phone, '(850) 426-8479');
  assert.equal(CUSTOMER_EMAIL_BUSINESS.email, 'owner@sparkling-standard.com');
  assert.equal(CUSTOMER_EMAIL_BUSINESS.website, 'sparkling-standard.com');
  for (const literal of [
    "'Sparkling Standard Cleaning Co.'",
    "firstName: 'Hayli'",
    "formatPhone('850-426-8479')",
    "'owner@sparkling-standard.com'",
    "'https://sparkling-standard.com'",
  ]) {
    assert.ok(source.includes(literal), `business.ts no longer contains ${literal}`);
  }
});

test('a valid request sends one branded confirmation with the fixed subject', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }),
    async (calls) => {
      const outcome = await sendCustomerConfirmation(fields, { RESEND_API_KEY: 'dummy-resend-key' });
      assert.equal(outcome.status, 'sent');
      assert.equal(calls.length, 1, 'exactly one Resend call');
      const call = calls[0];
      assert.equal(call.url, RESEND_ENDPOINT);
      assert.equal(call.init?.method, 'POST');
      const headers = call.init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer dummy-resend-key');
      const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
      assert.deepEqual(body.to, ['synthetic@example.com'], 'correct recipient');
      assert.equal(body.subject, 'We received your Sparkling Standard request', 'fixed subject');
      assert.equal(body.from, DEFAULT_CUSTOMER_EMAIL_FROM);
      assert.equal(body.reply_to, DEFAULT_CUSTOMER_EMAIL_REPLY_TO);
      assert.match(String(body.html), /We received your request/);
      assert.match(String(body.html), /House cleaning \(standard\)/);
      assert.match(String(body.text), /WE RECEIVED YOUR REQUEST/);
      assert.match(String(body.text), /100 S Baylen St, Pensacola, FL 32502/);
      assert.doesNotMatch(String(body.subject), /booking confirmed|receipt|invoice/i);
    },
  );
});

test('sender and reply-to can be overridden by environment configuration', async () => {
  await withFetch(
    async () => new Response('{}', { status: 200 }),
    async (calls) => {
      const outcome = await sendCustomerConfirmation(fields, {
        RESEND_API_KEY: 'dummy-resend-key',
        RESEND_FROM_EMAIL: 'Sparkling Standard Cleaning Co. <hello@verified.example>',
        RESEND_REPLY_TO: 'replies@sparkling-standard.com',
      });
      assert.equal(outcome.status, 'sent');
      const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
      assert.equal(body.from, 'Sparkling Standard Cleaning Co. <hello@verified.example>');
      assert.equal(body.reply_to, 'replies@sparkling-standard.com');
    },
  );
});

test('a request without an email address skips without calling the provider', async () => {
  await withFetch(
    async () => new Response('{}', { status: 200 }),
    async (calls) => {
      const outcome = await sendCustomerConfirmation({ phone: '8500000000' }, { RESEND_API_KEY: 'dummy-resend-key' });
      assert.equal(outcome.status, 'skipped_no_email');
      assert.equal(calls.length, 0);
    },
  );
});

test('an invalid email address is skipped, never sent', async () => {
  await withFetch(
    async () => new Response('{}', { status: 200 }),
    async (calls) => {
      const outcome = await sendCustomerConfirmation(
        { ...fields, email: 'not-an-email' },
        { RESEND_API_KEY: 'dummy-resend-key' },
      );
      assert.equal(outcome.status, 'skipped_invalid_email');
      assert.equal(calls.length, 0);
    },
  );
});

test('without an API key the send is skipped, not attempted', async () => {
  await withFetch(
    async () => new Response('{}', { status: 200 }),
    async (calls) => {
      const outcome = await sendCustomerConfirmation(fields, {});
      assert.equal(outcome.status, 'skipped_not_configured');
      assert.equal(calls.length, 0);
    },
  );
});

test('a provider rejection is reported as a failure with its status only', async () => {
  await withFetch(
    async () => new Response('{"error":"domain not verified"}', { status: 403 }),
    async () => {
      const outcome = await sendCustomerConfirmation(fields, { RESEND_API_KEY: 'dummy-resend-key' });
      assert.equal(outcome.status, 'failed');
      assert.equal(outcome.providerStatus, 403);
      assert.equal(JSON.stringify(outcome).includes('dummy-resend-key'), false);
      assert.equal(JSON.stringify(outcome).includes('synthetic@example.com'), false);
    },
  );
});

test('a network failure is reported as a failure and never throws', async () => {
  await withFetch(
    async () => {
      throw new Error('network down');
    },
    async () => {
      const outcome = await sendCustomerConfirmation(fields, { RESEND_API_KEY: 'dummy-resend-key' });
      assert.equal(outcome.status, 'failed');
      assert.equal(outcome.providerStatus, undefined);
    },
  );
});

test('customer-submitted content is sanitized before it reaches the email HTML', async () => {
  await withFetch(
    async () => new Response('{}', { status: 200 }),
    async (calls) => {
      await sendCustomerConfirmation(
        { ...fields, service_address: '<script>alert(1)</script>' },
        { RESEND_API_KEY: 'dummy-resend-key' },
      );
      const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
      assert.doesNotMatch(String(body.html), /<script>alert/);
      assert.match(String(body.html), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    },
  );
});

test('the log line never contains PII or the API key', () => {
  const failed = describeCustomerEmailOutcome({ status: 'failed', providerStatus: 422 });
  assert.equal(failed, 'customer-confirmation: failed (provider 422)');
  assert.doesNotMatch(failed, /synthetic@example\.com|dummy-resend-key/i);
  assert.equal(describeCustomerEmailOutcome({ status: 'sent' }), 'customer-confirmation: sent');
  assert.equal(describeCustomerEmailOutcome({ status: 'skipped_no_email' }), 'customer-confirmation: skipped_no_email');
});
