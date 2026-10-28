import { test } from 'node:test';
import assert from 'node:assert/strict';

import { refundStripeGiftPayment } from '../src/lib/gift/stripe-refund.ts';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a Stripe gift refund retrieves the payment intent and uses a stable idempotency key', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/v1/checkout/sessions/')) {
      return jsonResponse({ id: 'cs_test_1', payment_intent: 'pi_test_1' });
    }
    if (String(url).endsWith('/v1/refunds')) {
      return jsonResponse({ id: 're_test_1', status: 'succeeded' });
    }
    return jsonResponse({ error: { message: 'unexpected' } }, 500);
  };
  const result = await refundStripeGiftPayment({
    secretKey: 'sk_test_dummy',
    sessionId: 'cs_test_1',
    code: 'SSGC-ABCD-2345',
    fetcher: fetcher as typeof fetch,
  });
  assert.deepEqual(result, { ok: true, refundId: 're_test_1' });
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /\/v1\/checkout\/sessions\/cs_test_1$/);
  assert.equal(calls[0]!.init?.method, 'GET');
  assert.equal(calls[1]!.init?.method, 'POST');
  assert.equal((calls[1]!.init?.headers as Record<string, string>)['Idempotency-Key'], 'gift-refund-SSGC-ABCD-2345');
  const body = calls[1]!.init?.body as URLSearchParams;
  assert.equal(body.get('payment_intent'), 'pi_test_1');
  assert.equal(body.get('metadata[gift_code]'), 'SSGC-ABCD-2345');
  assert.equal(
    (calls[0]!.init?.headers as Record<string, string>).Authorization,
    'Bearer sk_test_dummy',
  );
});

test('an invalid session id fails before any provider call', async () => {
  let calls = 0;
  const result = await refundStripeGiftPayment({
    secretKey: 'sk_test_dummy',
    sessionId: 'not-a-session',
    code: 'SSGC-ABCD-2345',
    fetcher: (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });
  assert.deepEqual(result, { ok: false, error: 'invalid_session' });
  assert.equal(calls, 0);
});

test('a session without a payment intent never creates a refund', async () => {
  let calls = 0;
  const result = await refundStripeGiftPayment({
    secretKey: 'sk_test_dummy',
    sessionId: 'cs_test_1',
    code: 'SSGC-ABCD-2345',
    fetcher: (async () => {
      calls += 1;
      return jsonResponse({ id: 'cs_test_1', payment_intent: null });
    }) as typeof fetch,
  });
  assert.deepEqual(result, { ok: false, error: 'payment_not_found' });
  assert.equal(calls, 1);
});

test('a provider rejection never reports a refund', async () => {
  let calls = 0;
  const result = await refundStripeGiftPayment({
    secretKey: 'sk_test_dummy',
    sessionId: 'cs_test_1',
    code: 'SSGC-ABCD-2345',
    fetcher: (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ id: 'cs_test_1', payment_intent: 'pi_test_1' });
      return jsonResponse({ error: { message: 'declined' } }, 402);
    }) as typeof fetch,
  });
  assert.deepEqual(result, { ok: false, error: 'provider_failed' });
});
