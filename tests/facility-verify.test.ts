import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import { verifyFacilityQuote } from '../src/lib/estimate/facility-verify.ts';
import { pricing } from '../src/config/pricing.ts';

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
  assert.ok(result.expectedCleaning && result.expectedCleaning >= 125);
});

test('a tampered cleaning price is flagged as a mismatch', () => {
  const result = verifyFacilityQuote(fieldsFor({ cleaning_subtotal: '15' }));
  assert.equal(result.status, 'mismatch');
});

test('a stale configuration version is flagged', () => {
  const result = verifyFacilityQuote(fieldsFor({ quote_config_version: 'old' }));
  assert.equal(result.configMatch, 'mismatch');
  assert.equal(result.status, 'mismatch');
});

test('church verification recomputes the 10% discount', () => {
  const workload = calculateFacilityWorkload({ ...baseInput, facilityType: 'church' });
  const price = calculateFacilityPrice(workload, 'weekly', { church: true });
  const result = verifyFacilityQuote(
    fieldsFor({
      engine_type: 'church',
      service_type: 'church_cleaning',
      facility_type: 'church',
      cleaning_subtotal: String(price.cleaningSubtotal),
      church_discount_percent: '10',
    }),
  );
  assert.notEqual(result.status, 'mismatch');
  assert.equal(result.discountAmount, price.discount?.amount);
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
