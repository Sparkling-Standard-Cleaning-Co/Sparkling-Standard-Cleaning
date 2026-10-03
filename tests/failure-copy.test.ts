// Failure-copy tests — customer-facing messaging for failed lead submissions.
// Run with: npm test  (Node's built-in test runner + TypeScript type stripping)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contactAlternatives, failureCopy } from '../src/lib/forms/failure-copy.ts';

const confirmed = {
  phoneDisplay: '(850) 426-8479',
  email: 'owner@sparkling-standard.com',
  smsEnabled: false,
};

test('contact alternatives list call and email when SMS is not verified', () => {
  const text = contactAlternatives(confirmed);
  assert.match(text, /call \(850\) 426-8479/);
  assert.match(text, /email owner@sparkling-standard\.com/);
  assert.doesNotMatch(text, /text /);
});

test('contact alternatives include text only when SMS is verified', () => {
  const text = contactAlternatives({ ...confirmed, smsEnabled: true });
  assert.match(text, /text \(850\) 426-8479/);
});

test('contact alternatives fall back safely when no facts exist', () => {
  assert.equal(contactAlternatives({}), 'use the contact page');
});

test('not-configured copy is honest and offers real alternatives', () => {
  const text = failureCopy('not_configured', confirmed);
  assert.match(text, /not connected/i);
  assert.match(text, /\(850\) 426-8479/);
  assert.doesNotMatch(text, /text /);
});

test('spam rejection never claims success and offers alternatives', () => {
  const text = failureCopy('spam_rejected', confirmed);
  assert.match(text, /could not be verified/i);
  assert.match(text, /owner@sparkling-standard\.com/);
});

test('verification failure is distinct from a spam rejection and promises answers are kept', () => {
  const text = failureCopy('verification_failed', confirmed);
  assert.match(text, /security check/i);
  assert.match(text, /your answers are still here/i);
  assert.doesNotMatch(text, /could not be verified/i);
});

test('invalid form data gets a fix-the-form message, never a spam accusation', () => {
  const text = failureCopy('invalid_request', confirmed);
  assert.match(text, /didn't come through/i);
  assert.match(text, /check the form/i);
  assert.doesNotMatch(text, /could not be verified/i);
});

test('every failure reason produces an honest message with alternatives', () => {
  const reasons = [
    'not_configured',
    'provider_error',
    'network_error',
    'server_error',
    'spam_rejected',
    'verification_failed',
    'invalid_request',
  ] as const;
  for (const reason of reasons) {
    const text = failureCopy(reason, confirmed);
    assert.ok(text.length > 20, reason);
    assert.match(text, /\(850\) 426-8479/, reason);
  }
});

test('SMS never appears in failure copy while the gate is off', () => {
  const reasons = [
    'not_configured',
    'provider_error',
    'network_error',
    'server_error',
    'spam_rejected',
    'verification_failed',
    'invalid_request',
  ] as const;
  for (const reason of reasons) {
    assert.doesNotMatch(failureCopy(reason, confirmed), /text \(850\)/, reason);
  }
});
