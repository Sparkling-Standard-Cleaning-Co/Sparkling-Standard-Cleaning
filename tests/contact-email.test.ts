import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  customerEmailProblem,
  isValidCustomerEmail,
  normalizeCustomerEmail,
} from '../src/lib/forms/contact-email.ts';

test('customer email is required, syntax-checked and normalized', () => {
  assert.equal(customerEmailProblem(undefined), 'email_required');
  assert.equal(customerEmailProblem(''), 'email_required');
  assert.equal(customerEmailProblem('   '), 'email_required');
  assert.equal(customerEmailProblem('not-an-email'), 'email_invalid');
  assert.equal(customerEmailProblem('a@b'), 'email_invalid');
  assert.equal(customerEmailProblem('  Customer@Example.TEST  '), null);
  assert.equal(normalizeCustomerEmail('  Customer@Example.TEST  '), 'customer@example.test');
});

test('email syntax does not claim ownership verification', () => {
  assert.equal(isValidCustomerEmail('customer@example.test'), true);
  assert.equal(isValidCustomerEmail('customer@example.test<script>'), false);
  assert.equal(isValidCustomerEmail('a'.repeat(250) + '@example.test'), false);
});
