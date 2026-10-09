// Customer-facing request summary tests — the same facts the customer sees
// on the thank-you page and in the confirmation email, with the same honesty
// rules. Run with: npm test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRequestSummary, formatSummaryDate } from '../src/lib/forms/request-summary.ts';

const reservationFields: Record<string, string> = {
  request_type: 'reservation_request',
  service_type: 'standard',
  frequency: 'biweekly',
  property_type: 'house',
  square_feet: '1600',
  bedrooms: '3',
  full_baths: '2',
  service_address: '100 S Baylen St',
  address_city: 'Pensacola',
  address_state: 'FL',
  zip: '32502',
  preferred_date: '2026-12-15',
  arrival_preference: 'morning',
  quoted_price: '200',
  quoted_range: '$180–$220',
  quote_reference: 'SS-20261002-ABC123',
  estimated_labor_hours: '4.66',
  applied_rate_per_labor_hour: '42',
};

test('a reservation summary carries the submitted facts and the provisional estimate', () => {
  const summary = buildRequestSummary(reservationFields);
  assert.equal(summary.kind, 'reservation');
  assert.equal(summary.title, 'Reservation request');
  assert.equal(summary.reference, 'SS-20261002-ABC123');

  const byLabel = Object.fromEntries(summary.rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel['Service'], 'House cleaning (standard)');
  assert.equal(byLabel['Frequency'], 'Every two weeks');
  assert.equal(byLabel['Home'], '1600 sq ft · 3 bed · 2 full bath');
  assert.equal(byLabel['Service address'], '100 S Baylen St, Pensacola, FL 32502');
  assert.equal(byLabel['Preferred date'], 'Tuesday, December 15, 2026');
  assert.equal(byLabel['Arrival preference'], 'Morning window');

  assert.ok(summary.estimate, 'an estimate is present');
  assert.equal(summary.estimate?.label, 'Provisional estimate range');
  assert.equal(summary.estimate?.value, '$180–$220');
  assert.match(summary.estimate?.note ?? '', /final scope and price are confirmed personally/i);
});

test('a server-checked range is labeled as checked but still not final', () => {
  const summary = buildRequestSummary({ ...reservationFields, verified_range: '$210–$255' });
  assert.equal(summary.estimate?.label, 'Server-checked estimate range');
  assert.equal(summary.estimate?.value, '$210–$255');
  assert.match(summary.estimate?.note ?? '', /Final scope, price and travel are confirmed personally/i);
});

test('an estimate request without a quote uses the estimated range', () => {
  const summary = buildRequestSummary({
    request_type: 'residential_estimate',
    service_type: 'deep',
    frequency: 'one_time',
    estimate_low: '250',
    estimate_high: '300',
    address_city: 'Cantonment',
    address_state: 'FL',
    zip: '32533',
  });
  assert.equal(summary.kind, 'estimate');
  assert.equal(summary.title, 'Estimate request');
  assert.equal(summary.estimate?.label, 'Provisional estimate range');
  assert.equal(summary.estimate?.value, '$250 – $300');
});

test('a request without any estimate omits the estimate line entirely', () => {
  const summary = buildRequestSummary({
    request_type: 'residential_estimate',
    service_type: 'standard',
    frequency: 'one_time',
    name: 'Synthetic',
    phone: '8500000000',
  });
  assert.equal(summary.estimate, null);
});

test('a gift request summarizes the recipient instead of a service address', () => {
  const summary = buildRequestSummary({
    name: 'Synthetic',
    phone: '8500000000',
    recipient_name: 'Someone Special',
    gift_value: '100',
  });
  assert.equal(summary.kind, 'gift');
  assert.equal(summary.title, 'Gift certificate request');
  const byLabel = Object.fromEntries(summary.rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel['Recipient'], 'Someone Special');
  assert.equal(byLabel['Gift value'], '100');
  assert.equal(byLabel['Service address'], undefined);
});

test('a commercial request is titled as a walkthrough request', () => {
  const summary = buildRequestSummary({
    organization: 'Example Church',
    facility_type: 'church',
    name: 'Facilities Lead',
    phone: '8500000000',
  });
  assert.equal(summary.kind, 'commercial');
  assert.equal(summary.title, 'Commercial walkthrough request');
  const byLabel = Object.fromEntries(summary.rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel['Service'], 'Commercial — Church');
});

test('a turnover request labels the turnover rhythm, not a cleaning frequency', () => {
  const summary = buildRequestSummary({
    property_location: '12 Beach Rd, Pensacola Beach, FL 32561',
    turnover_frequency: 'per_stay',
    name: 'Host',
    phone: '8500000000',
  });
  assert.equal(summary.kind, 'str');
  assert.equal(summary.title, 'Short-term rental turnover request');
  const byLabel = Object.fromEntries(summary.rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel['Turnovers'], 'Every turnover');
  assert.equal(byLabel['Service address'], '12 Beach Rd, Pensacola Beach, FL 32561');
});

test('a website message summarizes only what was submitted', () => {
  const summary = buildRequestSummary({
    request_type: 'contact',
    name: 'Synthetic',
    phone: '8500000000',
    message: 'Hello',
  });
  assert.equal(summary.kind, 'contact');
  assert.equal(summary.title, 'Website message');
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.estimate, null);
});

test('a missing address is marked "to be confirmed", never invented', () => {
  const summary = buildRequestSummary({
    request_type: 'reservation_request',
    service_type: 'standard',
    frequency: 'weekly',
    name: 'Synthetic',
    phone: '8500000000',
  });
  const byLabel = Object.fromEntries(summary.rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel['Service address'], 'To be confirmed with you');
});

test('internal fields are never surfaced in the customer summary', () => {
  const summary = buildRequestSummary({
    ...reservationFields,
    quote_verified: 'mismatch',
    server_config_version: '2026-10-01.option-c.v1',
    verification_note: 'internal note',
    pin_latitude: '30.41108',
    pin_longitude: '-87.21641',
  });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /mismatch|option-c|internal note|30\.41108/i);
});

test('date formatting is human-readable and stable', () => {
  assert.equal(formatSummaryDate('2026-12-15'), 'Tuesday, December 15, 2026');
  assert.equal(formatSummaryDate('not-a-date'), 'not-a-date');
});
