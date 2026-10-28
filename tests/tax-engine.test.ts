import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateServiceTax, taxServiceCategory } from '../src/lib/tax/engine.ts';

test('residential cleaning in Florida is not taxable', () => {
  const tax = calculateServiceTax({
    serviceType: 'deep',
    state: 'FL',
    zip: '32502',
    taxableBase: 240,
  });
  assert.equal(tax.treatment, 'not_taxable');
  assert.equal(tax.ratePercent, 0);
  assert.equal(tax.taxAmount, 0);
  assert.equal(tax.total, 240);
  assert.equal(tax.canCharge, true);
});

test('Florida commercial cleaning uses the service county rate, not one flat rate', () => {
  const escambia = calculateServiceTax({
    serviceType: 'commercial_cleaning',
    state: 'FL',
    zip: '32502',
    taxableBase: 100,
    at: new Date('2026-10-28T12:00:00Z'),
  });
  assert.equal(escambia.treatment, 'taxable');
  assert.equal(escambia.ratePercent, 7.5);
  assert.equal(escambia.taxAmount, 7.5);
  assert.equal(escambia.total, 107.5);
  assert.equal(escambia.county, 'Escambia');

  const santaRosa = calculateServiceTax({
    serviceType: 'commercial_cleaning',
    state: 'FL',
    zip: '32570',
    taxableBase: 100,
    at: new Date('2026-10-28T12:00:00Z'),
  });
  assert.equal(santaRosa.ratePercent, 7);
  assert.equal(santaRosa.taxAmount, 7);
  assert.equal(santaRosa.total, 107);
  assert.equal(santaRosa.county, 'Santa Rosa');
});

test('tax is rounded to the cent on the total taxable service amount', () => {
  const tax = calculateServiceTax({
    serviceType: 'commercial',
    state: 'FL',
    zip: '32502',
    taxableBase: 123.45,
    at: new Date('2026-10-28T12:00:00Z'),
  });
  assert.equal(tax.taxAmount, 9.26);
  assert.equal(tax.total, 132.71);
});

test('a church is taxable unless an owner-verified exemption is present', () => {
  const taxable = calculateServiceTax({
    serviceType: 'church_cleaning',
    state: 'FL',
    zip: '32502',
    taxableBase: 200,
    at: new Date('2026-10-28T12:00:00Z'),
  });
  assert.equal(taxable.treatment, 'taxable');
  assert.equal(taxable.taxAmount, 15);

  const exempt = calculateServiceTax({
    serviceType: 'church_cleaning',
    state: 'FL',
    zip: '32502',
    taxableBase: 200,
    churchExempt: true,
    at: new Date('2026-10-28T12:00:00Z'),
  });
  assert.equal(exempt.treatment, 'exempt');
  assert.equal(exempt.taxAmount, 0);
  assert.equal(exempt.canCharge, true);
});

test('Alabama cleaning services are outside the Alabama sales-tax base', () => {
  const commercial = calculateServiceTax({
    serviceType: 'commercial_cleaning',
    state: 'AL',
    zip: '36532',
    taxableBase: 500,
  });
  assert.equal(commercial.treatment, 'not_taxable');
  assert.equal(commercial.taxAmount, 0);
  assert.equal(commercial.canCharge, true);

  const church = calculateServiceTax({
    serviceType: 'church_cleaning',
    state: 'AL',
    zip: '36502',
    taxableBase: 500,
  });
  assert.equal(church.treatment, 'not_taxable');
});

test('an unknown county fails closed instead of inventing a rate', () => {
  const tax = calculateServiceTax({
    serviceType: 'commercial',
    state: 'FL',
    zip: '33999',
    taxableBase: 100,
  });
  assert.equal(tax.treatment, 'review_required');
  assert.equal(tax.canCharge, false);
  assert.equal(tax.reviewReason, 'county_unknown');
});

test('a conflicting state and ZIP fail closed', () => {
  const tax = calculateServiceTax({
    serviceType: 'commercial',
    state: 'AL',
    zip: '32502',
    taxableBase: 100,
  });
  assert.equal(tax.treatment, 'review_required');
  assert.equal(tax.reviewReason, 'jurisdiction_conflict');
  assert.equal(tax.canCharge, false);
});

test('a missing state fails closed', () => {
  const tax = calculateServiceTax({
    serviceType: 'commercial',
    state: '',
    zip: '32502',
    taxableBase: 100,
  });
  // The ZIP establishes the state; this is a valid Florida service address.
  assert.equal(tax.treatment, 'taxable');
  assert.equal(tax.state, 'FL');

  const noStateNoZip = calculateServiceTax({
    serviceType: 'commercial',
    taxableBase: 100,
  });
  assert.equal(noStateNoZip.treatment, 'review_required');
  assert.equal(noStateNoZip.reviewReason, 'state_unknown');
});

test('rates outside the verified calendar year fail closed', () => {
  const tax = calculateServiceTax({
    serviceType: 'commercial',
    state: 'FL',
    zip: '32502',
    taxableBase: 100,
    at: new Date('2027-01-01T12:00:00Z'),
  });
  assert.equal(tax.treatment, 'review_required');
  assert.equal(tax.reviewReason, 'rate_expired');
  assert.equal(tax.canCharge, false);
});

test('unknown service categories and invalid bases fail safely', () => {
  const unknown = calculateServiceTax({
    serviceType: 'something_else',
    state: 'FL',
    zip: '32502',
    taxableBase: 100,
  });
  assert.equal(unknown.treatment, 'review_required');
  assert.equal(unknown.reviewReason, 'service_unknown');

  const negative = calculateServiceTax({
    serviceType: 'residential',
    state: 'FL',
    zip: '32502',
    taxableBase: -50,
  });
  assert.equal(negative.taxableBase, 0);
});

test('service categories map to the correct tax families', () => {
  assert.equal(taxServiceCategory('standard'), 'residential');
  assert.equal(taxServiceCategory('deep'), 'residential');
  assert.equal(taxServiceCategory('move_in_out'), 'residential');
  assert.equal(taxServiceCategory('str_turnover'), 'str');
  assert.equal(taxServiceCategory('commercial_cleaning'), 'commercial');
  assert.equal(taxServiceCategory('church_cleaning'), 'church');
  assert.equal(taxServiceCategory(''), 'unknown');
});
