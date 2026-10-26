// Transparent pricing breakdown tests — ONE authoritative model shared by the
// customer display, the instant quote and the server verification.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { pricing, pricingValue } from '../src/config/pricing.ts';
import { resolveAddonCharge } from '../src/lib/estimate/addons.ts';
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
  assert.equal(p.ratePerLaborHour, pricingValue(pricing.laborEconomics.targetGrossRevenuePerLaborHour));
  assert.equal(p.pricingCategory, 'other_services');
  for (const line of p.addonPrices.filter((addon) => !addon.customQuote)) {
    const definition = pricing.addons.items.find((addon) => addon.id === line.id);
    assert.ok(definition);
    const expected = definition.fixedPriceUsd && definition.fixedPriceUsd > 0
      ? definition.fixedPriceUsd
      : Math.round((definition.laborHours ?? 0) * p.ratePerLaborHour * 100) / 100;
    assert.equal(line.charge, expected);
  }
  // Specialty work is never priced instantly.
  for (const line of p.addonPrices.filter((addon) => addon.customQuote)) {
    assert.equal(line.charge, null);
  }

  // base + extras − discount + rounding = proposed total, exactly.
  // base + extras + base rounding - discount + engine calibration factor + travel = total.
  const expectedTotal =
    Math.round(
      (p.basePrice +
        p.extrasSubtotal +
        p.roundingAdjustment -
        (p.discount?.amount ?? 0) +
        p.globalAdjustment +
        p.travelAdjustment) *
        100,
    ) / 100;
  assert.equal(expectedTotal, p.subtotal);
  assert.equal(selectInstantAmount(result), p.subtotal, 'the offered price equals the breakdown total');
});

test('recurring maintenance drives the recurring rate and its add-on charges', () => {
  const recurring = calculateEstimate(input({ frequency: 'biweekly', addonIds: ['inside_oven'] }), context());
  const oven = pricing.addons.items.find((addon) => addon.id === 'inside_oven');
  assert.ok(oven);
  // P12: the primary breakdown prices the required first-visit Deep Cleaning;
  // the recurring rhythm and its rate live in the ongoing summary.
  assert.ok(recurring.ongoing, 'a new recurring arrangement carries an ongoing summary');
  assert.equal(recurring.ongoing.pricing.pricingCategory, 'recurring_maintenance');
  assert.equal(
    recurring.ongoing.pricing.ratePerLaborHour,
    pricingValue(pricing.laborEconomics.recurringGrossRevenuePerLaborHour),
  );
  const ongoingOven = recurring.ongoing.pricing.addonPrices.find((addon) => addon.id === 'inside_oven');
  assert.equal(ongoingOven?.charge, resolveAddonCharge(oven, recurring.ongoing.pricing.ratePerLaborHour));

  const oneTime = calculateEstimate(input({ frequency: 'one_time', addonIds: ['inside_oven'] }), context());
  const oneTimeOven = oneTime.pricing.addonPrices.find((addon) => addon.id === 'inside_oven');
  assert.equal(oneTimeOven?.charge, resolveAddonCharge(oven, oneTime.pricing.ratePerLaborHour));
  const firstVisitOven = recurring.pricing.addonPrices.find((addon) => addon.id === 'inside_oven');
  assert.equal(firstVisitOven?.charge, resolveAddonCharge(oven, recurring.pricing.ratePerLaborHour));
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
  const total = withExtras.pricing.subtotal;
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

test('tiny jobs never show an effective discount and still reconcile', () => {
  const tiny = calculateEstimate(
    input({
      squareFeet: 200,
      bedrooms: 0,
      fullBaths: 0,
      propertyType: 'apartment',
      frequency: 'biweekly',
    }),
    context({ addonIncentive: incentive(true) }),
  );
  assert.equal(tiny.status, 'estimated');
  assert.ok((tiny.pricing.subtotal ?? 0) >= pricing.minimumJob.value);
  assert.equal(tiny.pricing.discount, null);
  assert.equal(selectInstantAmount(tiny), tiny.pricing.subtotal);
  // The smaller ongoing rhythm also has no eligible add-on discount.
  assert.ok(tiny.ongoing);
  assert.ok((tiny.ongoing.perVisitPrice ?? 0) >= pricing.minimumJob.value);
  assert.equal(tiny.ongoing.pricing.discount, null, 'no eligible add-on incentive applies');
});

test('custom-quote specialty work still blocks instant pricing under the unified model', () => {
  const result = calculateEstimate(input({ addonIds: ['carpet_cleaning'] }), context());
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(selectInstantAmount(result), null);
});
