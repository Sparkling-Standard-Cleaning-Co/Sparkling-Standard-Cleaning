import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import {
  stripFacilityPricingFields,
  verifyFacilityQuote,
} from '../src/lib/estimate/facility-verify.ts';
import { pricing, pricingValue } from '../src/config/pricing.ts';

const baseInput = {
  cleanableSqft: 2000,
  restroomFixtures: 6,
  breakroom: true,
  facilityType: 'office' as const,
  condition: 'average' as const,
  traffic: 'average' as const,
  flooring: 'mixed' as const,
};
const version = pricing.commercialPricing.configVersion.value;

function fieldsFor(overrides: Record<string, string> = {}): Record<string, string> {
  const workload = calculateFacilityWorkload(baseInput);
  const price = calculateFacilityPrice(workload, 'weekly');
  return {
    request_type: 'facility_estimate',
    engine_type: 'commercial',
    service_type: 'commercial_cleaning',
    facility_type: 'office',
    cleanable_sqft: '2000',
    restroom_fixtures: '6',
    breakroom: 'breakroom',
    condition: 'average',
    traffic: 'average',
    flooring: 'mixed',
    frequency: 'weekly',
    cleaning_subtotal: String(price.cleaningSubtotal),
    quoted_price: String(price.total),
    quote_config_version: version,
    travel_verified: 'true',
    ...overrides,
  };
}

test('server recomputation matches the browser facility price', () => {
  const result = verifyFacilityQuote(fieldsFor());
  assert.notEqual(result.status, 'mismatch');
  assert.equal(result.configMatch, 'match');
  assert.ok(result.expectedCleaning && result.expectedCleaning >= pricingValue(pricing.minimumJob));
});

test('a tampered cleaning price is flagged as a mismatch', () => {
  const result = verifyFacilityQuote(fieldsFor({ cleaning_subtotal: '15' }));
  assert.equal(result.status, 'mismatch');
});

test('server route evidence overrides client travel claims', () => {
  const verified = verifyFacilityQuote(fieldsFor(), {
    routedOneWayMiles: 10,
    routedTravelVerified: true,
  });
  assert.equal(verified.status, 'verified');
  assert.equal(verified.travelStatus, 'verified');

  const noRoute = verifyFacilityQuote(
    fieldsFor({ travel_one_way_miles: '999', travel_verified: 'true' }),
    { routedOneWayMiles: null, routedTravelVerified: false },
  );
  assert.notEqual(noRoute.status, 'verified');
  assert.equal(noRoute.travelStatus, 'preliminary');
  assert.equal(noRoute.expectedTotal, verifyFacilityQuote(fieldsFor()).expectedTotal);
});

test('a stale configuration version is flagged', () => {
  const result = verifyFacilityQuote(fieldsFor({ quote_config_version: 'old' }));
  assert.equal(result.configMatch, 'mismatch');
  assert.equal(result.status, 'mismatch');
});

test('church verification recomputes the configured discount', () => {
  const workload = calculateFacilityWorkload({ ...baseInput, facilityType: 'church' });
  const price = calculateFacilityPrice(workload, 'weekly', { church: true });
  const result = verifyFacilityQuote(
    fieldsFor({
      engine_type: 'church',
      service_type: 'church_cleaning',
      facility_type: 'church',
      cleaning_subtotal: String(price.cleaningSubtotal),
      quoted_price: String(price.total),
      church_discount_percent: String(pricing.churchDiscount.percent.value),
    }),
  );
  assert.notEqual(result.status, 'mismatch');
  assert.equal(result.discountAmount, price.discount?.amount);
});

test('a tampered final facility price is a mismatch even when the cleaning subtotal matches', () => {
  const result = verifyFacilityQuote(fieldsFor({ quoted_price: '1' }));
  assert.equal(result.status, 'mismatch');
});

test('a very large facility cannot be verified as a firm price', () => {
  const result = verifyFacilityQuote(fieldsFor({ cleanable_sqft: '30000', restroom_fixtures: '24' }));
  assert.equal(result.status, 'preliminary');
  assert.equal(result.expectedCleaning, null);
});

test('unverifiable input fails closed', () => {
  const result = verifyFacilityQuote(fieldsFor({ cleanable_sqft: '0' }));
  assert.equal(result.status, 'unverifiable');
  assert.equal(result.expectedCleaning, null);
});

test('the server enforces the owner kill switch even when a client submits prices', () => {
  const result = verifyFacilityQuote(
    fieldsFor({
      cleaning_subtotal: '9999',
      quoted_price: '9999',
      quoted_range: '$9,000-$10,000',
      church_discount_amount: '999',
      facility_tier: 'A',
    }),
    { numericEstimatesEnabled: false },
  );
  assert.equal(result.status, 'pricing_disabled');
  assert.equal(result.pricingEnabled, false);
  assert.equal(result.expectedCleaning, null);
  assert.equal(result.expectedRange, null);
  assert.equal(result.laborHours, null);
  assert.equal(result.discountAmount, null);
  assert.equal(result.configMatch, 'unknown');
});

test('disabled pricing strips every client-supplied facility price field', () => {
  const fields = fieldsFor({
    cleaning_subtotal: '9999',
    quoted_price: '9999',
    quoted_range: '$9,000-$10,000',
    monthly_price: '39996',
    church_discount_amount: '999',
    church_savings: '999',
    commercial_rate: '9999',
    travel_adjustment: '9999',
    labor_hours: '1',
    quote_config_version: 'forged',
    facility_tier: 'A',
    estimate_low: '1',
    estimate_high: '9999',
    estimate_confidence: 'high',
  });
  stripFacilityPricingFields(fields);
  assert.equal(fields.cleaning_subtotal, undefined);
  assert.equal(fields.quoted_price, undefined);
  assert.equal(fields.quoted_range, undefined);
  assert.equal(fields.monthly_price, undefined);
  assert.equal(fields.church_discount_amount, undefined);
  assert.equal(fields.church_savings, undefined);
  assert.equal(fields.commercial_rate, undefined);
  assert.equal(fields.travel_adjustment, undefined);
  assert.equal(fields.labor_hours, undefined);
  assert.equal(fields.quote_config_version, undefined);
  assert.equal(fields.facility_tier, undefined);
  assert.equal(fields.estimate_low, undefined);
  assert.equal(fields.estimate_high, undefined);
  assert.equal(fields.estimate_confidence, undefined);
  assert.equal(fields.estimate_status, 'custom_confirmation_required');
  // Scope facts survive for the owner's manual review.
  assert.equal(fields.cleanable_sqft, '2000');
  assert.equal(fields.frequency, 'weekly');
  assert.equal(fields.request_type, 'facility_estimate');
});
