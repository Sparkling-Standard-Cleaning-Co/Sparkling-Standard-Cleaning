import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBookingEmail, sendBookingEmail } from '../src/lib/forms/booking-email.ts';

const DATA = {
  reference: 'SS-20261030-TEST',
  customerName: 'Test Customer',
  dateLabel: 'Friday, October 30, 2026',
  timeLabel: '9:00 AM – 11:00 AM Central',
  address: '100 S Baylen St, Pensacola, FL 32502',
  service: 'Residential Cleaning',
  notes: 'Gate code 1234',
};

test('booking emails contain the confirmed details and no credential material', () => {
  for (const kind of ['confirmation', 'decline', 'proposal', 'reschedule', 'cancellation'] as const) {
    const email = buildBookingEmail({ PUBLIC_SITE_URL: 'https://sparkling-standard.com' }, {
      ...DATA,
      kind,
      ...(kind === 'decline' || kind === 'cancellation' ? { reason: 'The requested time is unavailable.' } : {}),
    });
    assert.ok(email.subject.length > 0);
    assert.match(email.text, /SS-20261030-TEST/);
    assert.match(email.text, /100 S Baylen St/);
    assert.match(email.text, /Test Customer/);
    assert.doesNotMatch(email.text, /re_[A-Za-z0-9]{20}/);
    assert.doesNotMatch(email.html, /whsec_|sk_live_|sk_test_/);
    if (kind === 'proposal') assert.match(email.text, /not a confirmed appointment/i);
    if (kind === 'confirmation') assert.match(email.subject, /confirmed/i);
  }
});

test('booking email delivery reports honest outcomes without exposing the address', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: 'email_test' }), { status: 200 });
  };
  const sent = await sendBookingEmail(
    { RESEND_API_KEY: 're_test_synthetic', RESEND_FROM_EMAIL: 'notifications@example.test' },
    'customer@example.test',
    { ...DATA, kind: 'confirmation' },
  );
  assert.equal(sent.status, 'sent');
  assert.equal(calls.length, 1);
  assert.equal((calls[0]!.to as string[])[0], 'customer@example.test');
  assert.match(String(calls[0]!.text), /Your cleaning is confirmed/);

  assert.deepEqual(await sendBookingEmail({}, 'customer@example.test', { ...DATA, kind: 'confirmation' }), {
    status: 'skipped_not_configured',
  });
  assert.deepEqual(await sendBookingEmail({ RESEND_API_KEY: 'x' }, '', { ...DATA, kind: 'confirmation' }), {
    status: 'skipped_no_email',
  });
  assert.deepEqual(await sendBookingEmail({ RESEND_API_KEY: 'x' }, 'not-an-email', { ...DATA, kind: 'confirmation' }), {
    status: 'skipped_invalid_email',
  });
});
