// Transparent pricing breakdown tests — ONE authoritative model shared by the
// customer display, the instant quote and the server verification.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { pricing } from '../src/config/pricing.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function context(overrides: Partial<EstimateContext> = {}): EstimateContext {
  return {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
      ...overrides.travel,
    },
    ...(overrides.addonIncentive ? { addonIncentive: overrides.addonIncentive } : {}),
  };
}

function input(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    serviceType: 'standard',
    propertyType: 'house',
    squareFeet: 1600,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 0,
    frequency: 'one_time',
    condition: 'maintained',
    lastClean: 'within_month',
    addonIds: [],
    zip: '32503',
    pets: 'none',
    ...overrides,
  };
}

const incentive = (enabled: boolean) => ({
  enabled,
  tiers: [
    { minAddons: 2, percent: 0.05 },
    { minAddons: 3, percent: 0.08 },
  ],
  maxDiscount: 75,
});

test('every eligible add-on has a labor-derived charge and the figures reconcile', () => {
  const result = calculateEstimate(input({ addonIds: ['inside_oven', 'laundry'] }), context());
  const p = result.pricing;
  assert.equal(result.status, 'estimated');

  // One authoritative method: charge = labor-hours × the applied rate.
  assert.equal(p.ratePerLaborHour, 50);
  assert.equal(p.pricingCategory, 'other_services');
  for (const line of p.addonPrices.filter((addon) => !addon.customQuote)) {
    assert.equal(line.charge, Math.round(line.laborHours * p.ratePerLaborHour * 100) / 100);
  }
  // Specialty work is never priced instantly.
  for (const line of p.addonPrices.filter((addon) => addon.customQuote)) {
    assert.equal(line.charge, null);
  }

  // base + extras − discount + rounding = proposed total, exactly.
  const total = p.subtotal + p.roundingAdjustment;
  assert.equal(
    Math.round((p.basePrice + p.extrasSubtotal - (p.discount?.amount ?? 0) + p.roundingAdjustment) * 100) / 100,
    Math.round(total * 100) / 100,
  );
  assert.equal(selectInstantAmount(result), total, 'the offered price equals the breakdown total');
});

test('recurring maintenance drives the recurring rate and its add-on charges', () => {
  const recurring = calculateEstimate(input({ frequency: 'biweekly', addonIds: ['inside_oven'] }), context());
  assert.equal(recurring.pricing.ratePerLaborHour, 42);
  assert.equal(recurring.pricing.pricingCategory, 'recurring_maintenance');
  const oven = recurring.pricing.addonPrices.find((addon) => addon.id === 'inside_oven');
  assert.equal(oven?.charge, Math.round(0.6 * 42 * 100) / 100);

  const oneTime = calculateEstimate(input({ frequency: 'one_time', addonIds: ['inside_oven'] }), context());
  assert.equal(oneTime.pricing.addonPrices.find((addon) => addon.id === 'inside_oven')?.charge, 30);
  assert.notEqual(recurring.pricing.addonPrices.find((a) => a.id === 'inside_oven')?.charge, 30);
});

test('the incentive is OFF by default and never changes the proposed price', () => {
  const without = calculateEstimate(input({ addonIds: ['inside_oven', 'laundry'] }), context());
  const withOverride = calculateEstimate(
    input({ addonIds: ['inside_oven', 'laundry'] }),
    context({ addonIncentive: incentive(false) }),
  );
  assert.equal(without.pricing.discount, null);
  assert.equal(withOverride.pricing.discount, null);
  assert.equal(without.pricing.subtotal, withOverride.pricing.subtotal);
});

test('two add-ons apply only the 5% tier; three apply only the 8% tier (never stacked)', () => {
  const two = calculateEstimate(
    input({ addonIds: ['inside_oven', 'laundry'] }),
    context({ addonIncentive: incentive(true) }),
  );
  assert.ok(two.pricing.discount);
  assert.equal(two.pricing.discount?.percent, 0.05);
  // Discount applies to the eligible add-on subtotal only.
  const extras = Math.round(two.pricing.selectedExtras.reduce((sum, extra) => sum + extra.charge, 0) * 100) / 100;
  assert.equal(two.pricing.extrasSubtotal, extras);
  assert.equal(two.pricing.discount?.amount, Math.round(extras * 0.05 * 100) / 100);

  const three = calculateEstimate(
    input({ addonIds: ['inside_oven', 'laundry', 'dishes'] }),
    context({ addonIncentive: incentive(true) }),
  );
  assert.ok(three.pricing.discount);
  assert.equal(three.pricing.discount?.percent, 0.08);
  // Only one tier: the 8% amount, not 5% + 8%.
  assert.notEqual(
    three.pricing.discount?.amount,
    Math.round(three.pricing.extrasSubtotal * 0.13 * 100) / 100,
  );
});

test('the incentive never discounts the base, travel or the minimum, and numbers still reconcile', () => {
  const base = calculateEstimate(input(), context({ addonIncentive: incentive(true) }));
  const withExtras = calculateEstimate(
    input({ addonIds: ['inside_oven', 'laundry'] }),
    context({ addonIncentive: incentive(true) }),
  );
  // The base cleaning price is unchanged by the promotion.
  assert.equal(withExtras.pricing.basePrice, base.pricing.basePrice);
  // Discount cannot exceed the eligible extras or push the job below base.
  assert.ok((withExtras.pricing.discount?.amount ?? 0) <= withExtras.pricing.extrasSubtotal);
  assert.ok(withExtras.pricing.subtotal >= withExtras.pricing.basePrice);
  const total = withExtras.pricing.subtotal + withExtras.pricing.roundingAdjustment;
  assert.equal(selectInstantAmount(withExtras), total);
});

test('the maximum cap bounds the incentive amount', () => {
  const result = calculateEstimate(
    input({ addonIds: ['inside_oven', 'inside_cabinets', 'laundry', 'organization_general'] }),
    context({ addonIncentive: { enabled: true, tiers: [{ minAddons: 2, percent: 0.5 }], maxDiscount: 10 } }),
  );
  assert.ok(result.pricing.discount);
  assert.equal(result.pricing.discount?.amount, 10);
});

test('minimum-price jobs never show an effective discount and still reconcile', () => {
  const tiny = calculateEstimate(
    input({
      squareFeet: 200,
      bedrooms: 0,
      fullBaths: 0,
      propertyType: 'apartment',
      frequency: 'biweekly',
      addonIds: ['dishes', 'bed_linen_change'],
    }),
    context({ addonIncentive: incentive(true) }),
  );
  assert.equal(tiny.status, 'estimated');
  assert.equal(tiny.pricing.minimumApplied, true);
  assert.equal(tiny.pricing.discount, null, 'the minimum absorbs any incentive');
  const total = tiny.pricing.subtotal + tiny.pricing.roundingAdjustment;
  assert.equal(total, pricing.minimumJob.value);
  assert.equal(selectInstantAmount(tiny), pricing.minimumJob.value);
});

test('custom-quote specialty work still blocks instant pricing under the unified model', () => {
  const result = calculateEstimate(input({ addonIds: ['carpet_cleaning'] }), context());
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(selectInstantAmount(result), null);
});
