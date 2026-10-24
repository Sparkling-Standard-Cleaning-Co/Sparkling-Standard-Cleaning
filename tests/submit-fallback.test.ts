// Direct-provider fallback integrity (Sparkling Standard 4.0 §3A).
//
// When the authoritative server relay is unavailable, a priced submission must
// NEVER reach the owner as a proposed/reservation price. The fallback degrades
// it to a nonbinding estimate request with explicitly unverified figures.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { directFallbackFields } from '../src/lib/forms/fallback-fields.ts';

function pricedFields(): Record<string, string> {
  return {
    request_type: 'reservation_request',
    service_type: 'standard',
    frequency: 'biweekly',
    quoted_price: '260',
    quoted_range: '$235–$285',
    first_visit_total: '260',
    ongoing_price_per_visit: '255',
    ongoing_frequency: 'biweekly',
    quote_reference: 'SS-20261024-ABC123',
    quote_config_version: '2026-10-23.floor5-travel35.v1',
    name: 'Customer Name',
    phone: '8500000000',
    email: 'customer@example.com',
    service_address: '100 S Baylen St',
  };
}

test('priced fallback: quote-claim fields are stripped and figures re-labeled unverified', () => {
  const result = directFallbackFields(pricedFields());
  // No quote claim may survive under its authoritative name.
  for (const key of [
    'quoted_price',
    'quoted_range',
    'first_visit_total',
    'ongoing_price_per_visit',
    'ongoing_frequency',
    'quote_reference',
    'quote_config_version',
  ]) {
    assert.equal(result[key], undefined, `${key} must be stripped on the fallback path`);
  }
  // The customer's figures survive only as explicitly unverified values.
  assert.equal(result.unverified_client_price, '260');
  assert.equal(result.unverified_client_range, '$235–$285');
  assert.equal(result.unverified_client_first_visit, '260');
  assert.equal(result.unverified_client_ongoing_price, '255');
  assert.equal(result.unverified_client_ongoing_frequency, 'biweekly');
  assert.equal(result.unverified_priced_request, 'yes');
  // The request can never read as a reservation.
  assert.equal(result.request_type, 'residential_estimate');
  // Customer inputs are preserved for the owner to follow up.
  assert.equal(result.name, 'Customer Name');
  assert.equal(result.service_address, '100 S Baylen St');
  assert.equal(result.frequency, 'biweekly');
});

test('priced fallback: a tampered client_price alone still triggers neutralisation', () => {
  const result = directFallbackFields({
    request_type: 'residential_estimate',
    client_price: '1',
    name: 'Tamper Test',
  });
  assert.equal(result.client_price, undefined);
  assert.equal(result.unverified_client_price, '1');
  assert.equal(result.unverified_priced_request, 'yes');
});

test('non-priced submissions pass through untouched (same reference)', () => {
  const fields = {
    request_type: 'contact',
    name: 'Message Sender',
    message: 'A general question.',
  };
  const result = directFallbackFields(fields);
  assert.equal(result, fields, 'non-priced submissions are not rewritten');
  assert.equal(result.quoted_price, undefined);
});
