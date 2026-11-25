import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStripeSecret,
  resolveStripeWebhookSecret,
} from '../src/lib/payments/stripe-secret.ts';

test('production uses only the production secret and never the test secret', () => {
  assert.equal(
    resolveStripeSecret({ STRIPE_SECRET_KEY: 'sk_live_prod', STRIPE_TEST_SECRET: 'sk_test_alt' }, true),
    'sk_live_prod',
  );
  assert.equal(resolveStripeSecret({ STRIPE_TEST_SECRET: 'sk_test_alt' }, true), '');
});

test('local and preview prefer STRIPE_TEST_SECRET and reject a live-only secret', () => {
  assert.equal(
    resolveStripeSecret({ STRIPE_SECRET_KEY: 'sk_live_accidental', STRIPE_TEST_SECRET: 'sk_test_sandbox' }, false),
    'sk_test_sandbox',
  );
  assert.equal(
    resolveStripeSecret({ STRIPE_SECRET_KEY: 'sk_live_accidental' }, false),
    '',
  );
  assert.equal(
    resolveStripeSecret({ STRIPE_SECRET_KEY: 'sk_test_legacy' }, false),
    'sk_test_legacy',
  );
});

test('webhook verification never reuses a production secret in a test environment', () => {
  assert.equal(
    resolveStripeWebhookSecret(
      { STRIPE_WEBHOOK_SECRET: 'whsec_live', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test' },
      false,
    ),
    'whsec_test',
  );
  assert.equal(
    resolveStripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: 'whsec_live' }, false),
    'whsec_live',
  );
  assert.equal(
    resolveStripeWebhookSecret(
      { STRIPE_WEBHOOK_SECRET: 'whsec_live', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test' },
      true,
    ),
    'whsec_live',
  );
  assert.equal(
    resolveStripeWebhookSecret({ STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test' }, true),
    '',
  );
});
