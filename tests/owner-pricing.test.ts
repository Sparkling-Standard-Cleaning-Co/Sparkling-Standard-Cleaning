// Owner pricing settings tests.
//
// Two jobs:
//  1. Consistency guard — every ownerPricing value consumed by pricing.ts must
//     equal the effective `.value` of its typed config entry, so an edit in
//     estimators/pricing-values.ts never silently drifts from the engine's config.
//  2. Fixed-price add-on resolution — the single charge resolver honors a
//     fixed price, falls back to labor-hours × rate, and never prices
//     specialty work.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ownerPricing } from '../src/config/estimators/pricing-values.ts';
import { pricing, pricingValue, type ConfigValue } from '../src/config/pricing.ts';
import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { resolveAddonCharge } from '../src/lib/estimate/addons.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { mapReservationFields } from '../src/lib/estimate/verify.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function context(overrides: Partial<EstimateContext['travel']> = {}): EstimateContext {
  return {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
      ...overrides,
    },
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Consistency guard ────────────────────────────────────────────────────────

test('every ownerPricing value consumed by pricing.ts matches its typed config entry', () => {
  const pairs: Array<[string, number, ConfigValue<number>]> = [
    ['hourlyRates.recurring', ownerPricing.hourlyRates.recurring, pricing.laborEconomics.recurringGrossRevenuePerLaborHour],
    ['hourlyRates.otherServices', ownerPricing.hourlyRates.otherServices, pricing.laborEconomics.targetGrossRevenuePerLaborHour],
    ['hourlyRates.ownerLaborTarget', ownerPricing.hourlyRates.ownerLaborTarget, pricing.laborEconomics.ownerLaborTargetPerHour],
    ['minimumJob', ownerPricing.minimumJob, pricing.minimumJob],
    ['baseLaborHours.standard', ownerPricing.baseLaborHours.standard, pricing.laborModel.baseHours.standard],
    ['baseLaborHours.deep', ownerPricing.baseLaborHours.deep, pricing.laborModel.baseHours.deep],
    ['baseLaborHours.move_in_out', ownerPricing.baseLaborHours.move_in_out, pricing.laborModel.baseHours.move_in_out],
    ['baseLaborHours.str_turnover', ownerPricing.baseLaborHours.str_turnover, pricing.laborModel.baseHours.str_turnover],
    ['laborUnits.sqftHoursPerThousand', ownerPricing.laborUnits.sqftHoursPerThousand, pricing.laborModel.sqftHoursPerThousand],
    ['laborUnits.fullBathHours', ownerPricing.laborUnits.fullBathHours, pricing.laborModel.fullBathHours],
    ['laborUnits.halfBathHours', ownerPricing.laborUnits.halfBathHours, pricing.laborModel.halfBathHours],
    ['laborUnits.bedroomHours', ownerPricing.laborUnits.bedroomHours, pricing.laborModel.bedroomHours],
    ['laborUnits.bedroomsIncludedInBase', ownerPricing.laborUnits.bedroomsIncludedInBase, pricing.laborModel.bedroomsIncludedInBase],
    ['laborUnits.strBathHours', ownerPricing.laborUnits.strBathHours, pricing.laborModel.strBathHours],
    ['laborUnits.strBedHours', ownerPricing.laborUnits.strBedHours, pricing.laborModel.strBedHours],
    ['laborUnits.strSqftHoursPerThousand', ownerPricing.laborUnits.strSqftHoursPerThousand, pricing.laborModel.strSqftHoursPerThousand],
    ['conditionFactors.maintained', ownerPricing.conditionFactors.maintained, pricing.conditionFactors.maintained],
    ['conditionFactors.average', ownerPricing.conditionFactors.average, pricing.conditionFactors.average],
    ['conditionFactors.needs_attention', ownerPricing.conditionFactors.needs_attention, pricing.conditionFactors.needs_attention],
    ['conditionFactors.heavy', ownerPricing.conditionFactors.heavy, pricing.conditionFactors.heavy],
    ['conditionFactors.severe', ownerPricing.conditionFactors.severe, pricing.conditionFactors.severe],
    ['lastCleanFactors.within_month', ownerPricing.lastCleanFactors.within_month, pricing.lastCleanFactors.within_month],
    ['lastCleanFactors.one_to_three_months', ownerPricing.lastCleanFactors.one_to_three_months, pricing.lastCleanFactors.one_to_three_months],
    ['lastCleanFactors.three_to_twelve_months', ownerPricing.lastCleanFactors.three_to_twelve_months, pricing.lastCleanFactors.three_to_twelve_months],
    ['lastCleanFactors.over_a_year', ownerPricing.lastCleanFactors.over_a_year, pricing.lastCleanFactors.over_a_year],
    ['lastCleanFactors.never_professional', ownerPricing.lastCleanFactors.never_professional, pricing.lastCleanFactors.never_professional],
    ['lastCleanFactors.not_sure', ownerPricing.lastCleanFactors.not_sure, pricing.lastCleanFactors.not_sure],
    ['frequencyFactors.weekly', ownerPricing.frequencyFactors.weekly, pricing.frequencyFactors.weekly],
    ['frequencyFactors.biweekly', ownerPricing.frequencyFactors.biweekly, pricing.frequencyFactors.biweekly],
    ['frequencyFactors.monthly', ownerPricing.frequencyFactors.monthly, pricing.frequencyFactors.monthly],
    ['frequencyFactors.one_time', ownerPricing.frequencyFactors.one_time, pricing.frequencyFactors.one_time],
    ['range.lowFactor', ownerPricing.range.lowFactor, pricing.range.lowFactor],
    ['range.highFactor', ownerPricing.range.highFactor, pricing.range.highFactor],
    ['rounding.roundToNearest', ownerPricing.rounding.roundToNearest, pricing.rounding.toNearest],
    ['promotions.addonIncentive maxDiscount', ownerPricing.promotions.addonIncentive.maxDiscount, pricing.addonIncentive.maxDiscount],
    ['promotions.addonIncentive.twoAddons.minAddons', ownerPricing.promotions.addonIncentive.twoAddons.minAddons, { value: pricing.addonIncentive.tiers[0]?.minAddons ?? Number.NaN, state: 'provisional', note: 'tier min' }],
    ['promotions.addonIncentive.twoAddons.percent', ownerPricing.promotions.addonIncentive.twoAddons.percent, pricing.addonIncentive.tiers[0]?.percent ?? { value: Number.NaN, state: 'provisional', note: 'tier percent' }],
    ['promotions.addonIncentive.threeOrMoreAddons.minAddons', ownerPricing.promotions.addonIncentive.threeOrMoreAddons.minAddons, { value: pricing.addonIncentive.tiers[1]?.minAddons ?? Number.NaN, state: 'provisional', note: 'tier min' }],
    ['promotions.addonIncentive.threeOrMoreAddons.percent', ownerPricing.promotions.addonIncentive.threeOrMoreAddons.percent, pricing.addonIncentive.tiers[1]?.percent ?? { value: Number.NaN, state: 'provisional', note: 'tier percent' }],
    ['promotions.responseGuarantee.windowBusinessHours', ownerPricing.promotions.responseGuarantee.windowBusinessHours, pricing.responseGuarantee.windowBusinessHours],
    ['promotions.responseGuarantee.discountPercent', ownerPricing.promotions.responseGuarantee.discountPercent, pricing.responseGuarantee.discountPercent],
    ['promotions.responseGuarantee.maxDiscount', ownerPricing.promotions.responseGuarantee.maxDiscount, pricing.responseGuarantee.maxDiscount],
  ];

  for (const [name, ownerValue, configValue] of pairs) {
    assert.equal(ownerValue, configValue.value, `owner-pricing drift: ${name}`);
  }

  assert.equal(ownerPricing.promotions.addonIncentive.enabled, pricing.addonIncentive.enabled.value);
  assert.equal(ownerPricing.promotions.responseGuarantee.enabled, pricing.responseGuarantee.enabled.value);
  assert.equal(ownerPricing.addons, pricing.addons.items, 'pricing.ts must consume the owner add-on list directly');
});

test('add-on definitions are structurally valid whether labor-based or fixed-price', () => {
  for (const addon of ownerPricing.addons) {
    if (addon.customQuote) {
      assert.equal(addon.laborHours, undefined, `${addon.id} custom work must not carry labor hours`);
      assert.equal(addon.fixedPriceUsd, undefined, `${addon.id} custom work must not carry a fixed price`);
    } else {
      assert.ok(
        (addon.laborHours ?? 0) > 0 || (addon.fixedPriceUsd ?? 0) > 0,
        `${addon.id} needs a labor-based or fixed charge`,
      );
    }
  }
});

// ── Fixed-price resolver ─────────────────────────────────────────────────────

test('resolveAddonCharge: labor-based add-on yields laborHours × rate', () => {
  assert.equal(resolveAddonCharge({ customQuote: false, laborHours: 0.6 }, 42), 25.2);
  assert.equal(resolveAddonCharge({ customQuote: false, laborHours: 0.7 }, 50), 35);
});

test('resolveAddonCharge: a fixed price wins over labor hours', () => {
  assert.equal(resolveAddonCharge({ customQuote: false, laborHours: 0.6, fixedPriceUsd: 35 }, 42), 35);
});

test('resolveAddonCharge: non-positive or non-finite fixed prices fall back to labor', () => {
  assert.equal(resolveAddonCharge({ customQuote: false, laborHours: 0.6, fixedPriceUsd: 0 }, 42), 25.2);
  assert.equal(resolveAddonCharge({ customQuote: false, laborHours: 0.6, fixedPriceUsd: -10 }, 42), 25.2);
  assert.equal(resolveAddonCharge({ customQuote: false, laborHours: 0.6, fixedPriceUsd: Number.NaN }, 42), 25.2);
});

test('resolveAddonCharge: custom-quote add-ons are never priced instantly', () => {
  assert.equal(resolveAddonCharge({ customQuote: true, fixedPriceUsd: 99 }, 50), null);
  assert.equal(resolveAddonCharge({ customQuote: true, laborHours: 0.5 }, 50), null);
});

test('calculateEstimate honors a fixed-price add-on while keeping its labor hours', () => {
  const oven = pricing.addons.items.find((item) => item.id === 'inside_oven');
  assert.ok(oven, 'inside_oven must exist');
  const originalFixedPrice = oven.fixedPriceUsd;
  try {
    oven.fixedPriceUsd = 35;
    const result = calculateEstimate(input({ addonIds: ['inside_oven'] }), context());
    assert.equal(result.status, 'estimated');
    const reduced = 35 * pricing.residentialExtras.priceFactor.value;
    const line = result.pricing.addonPrices.find((addon) => addon.id === 'inside_oven');
    assert.equal(line?.charge, reduced, 'the display line uses the fixed price after the owner reduction');
    assert.equal(result.pricing.selectedExtras[0]?.charge, reduced, 'the selected extra uses the fixed price after the owner reduction');
    assert.equal(result.pricing.extrasSubtotal, reduced, 'the extras subtotal uses the fixed price after the owner reduction');
    assert.equal(result.pricing.addonLaborHours, oven.laborHours, 'labor hours still count for scheduling');
  } finally {
    if (originalFixedPrice === undefined) {
      delete oven.fixedPriceUsd;
    } else {
      oven.fixedPriceUsd = originalFixedPrice;
    }
  }
});

// ── End-to-end reconciliation ────────────────────────────────────────────────

test('recurring 1600 sqft 3/2 biweekly with two add-ons reconciles client and server paths', () => {
  const client = calculateEstimate(
    input({ frequency: 'biweekly', addonIds: ['inside_oven', 'laundry'] }),
    context(),
  );
  assert.equal(client.status, 'estimated');
  assert.equal(client.minimumApplied, false);

  // P12: the primary breakdown prices the required FIRST VISIT — a Deep
  // Cleaning — and the ongoing biweekly rhythm lives in the summary.
  const p = client.pricing;
  assert.equal(p.ratePerLaborHour, pricingValue(pricing.laborEconomics.targetGrossRevenuePerLaborHour));
  assert.equal(p.pricingCategory, 'other_services');
  assert.ok(client.ongoing, 'a new recurring arrangement carries an ongoing summary');
  assert.equal(client.ongoing.pricing.pricingCategory, 'recurring_maintenance');
  assert.equal(client.ongoing.frequency, 'biweekly');

  // Independent formulas from the effective configuration.
  const unitHours =
    (1600 / 1000) * pricingValue(pricing.laborModel.sqftHoursPerThousand) +
    2 * pricingValue(pricing.laborModel.fullBathHours) +
    Math.max(0, 3 - pricingValue(pricing.laborModel.bedroomsIncludedInBase)) * pricingValue(pricing.laborModel.bedroomHours);

  // First visit: deep scope, one-time frequency.
  const firstLabor =
    (pricingValue(pricing.laborModel.baseHours.deep) + unitHours) *
    pricingValue(pricing.conditionFactors.maintained) *
    pricingValue(pricing.lastCleanFactors.within_month) *
    pricingValue(pricing.frequencyFactors.one_time);
  // Ongoing: standard scope at the chosen rhythm.
  const ongoingLabor =
    (pricingValue(pricing.laborModel.baseHours.standard) + unitHours) *
    pricingValue(pricing.conditionFactors.maintained) *
    pricingValue(pricing.lastCleanFactors.within_month) *
    pricingValue(pricing.frequencyFactors.biweekly);

  const oven = pricing.addons.items.find((addon) => addon.id === 'inside_oven');
  const laundry = pricing.addons.items.find((addon) => addon.id === 'laundry');
  assert.ok(oven && laundry);
  const ovenHours = oven.laborHours ?? 0;
  const laundryHours = laundry.laborHours ?? 0;
  const addonFactor = pricing.residentialExtras.priceFactor.value;
  const expectedExtras = round2(
    (resolveAddonCharge(oven, p.ratePerLaborHour, addonFactor) ?? 0) +
      (resolveAddonCharge(laundry, p.ratePerLaborHour, addonFactor) ?? 0),
  );
  const step = pricingValue(pricing.rounding.toNearest);
  const firstSubtotal = round2(firstLabor * p.ratePerLaborHour + round2(expectedExtras));
  const firstRounded = Math.floor(firstSubtotal / step) * step;
  const ongoingSubtotal = round2(ongoingLabor * p.ratePerLaborHour + round2(expectedExtras));
  const ongoingRounded = Math.floor(ongoingSubtotal / step) * step;

  // First visit reconciles (this is the price the customer submits). The base
  // is rounded to the configured presentation step before any discount/factor.
  assert.equal(p.baseLaborHours, round2(firstLabor));
  assert.equal(p.addonLaborHours, round2(ovenHours + laundryHours));
  assert.equal(p.extrasSubtotal, round2(expectedExtras));
  assert.equal(p.basePrice, round2(firstLabor * p.ratePerLaborHour));
  assert.equal(p.roundingAdjustment, round2(firstRounded - firstSubtotal));
  assert.equal(p.subtotal, firstRounded);
  assert.equal(selectInstantAmount(client), firstRounded);

  // Ongoing per-visit rhythm reconciles and stays cheaper than the deep visit.
  assert.equal(client.ongoing.pricing.baseLaborHours, round2(ongoingLabor));
  assert.equal(client.ongoing.pricing.extrasSubtotal, round2(expectedExtras));
  assert.equal(client.ongoing.pricing.subtotal, ongoingRounded);
  assert.equal(client.ongoing.perVisitPrice, ongoingRounded);
  assert.ok(ongoingRounded < firstRounded, 'maintenance visits cost less than the required deep first visit');

  // Server path: the same flat fields must reproduce BOTH amounts.
  const server = calculateEstimate(
    mapReservationFields({
      service_type: 'standard',
      property_type: 'house',
      square_feet: '1600',
      bedrooms: '3',
      full_baths: '2',
      half_baths: '0',
      frequency: 'biweekly',
      condition: 'maintained',
      last_cleaned: 'within_month',
      addon_ids: 'inside_oven,laundry',
      zip: '32503',
    }),
    context(),
  );
  assert.equal(selectInstantAmount(server), selectInstantAmount(client));
  assert.equal(server.pricing.subtotal, p.subtotal);
  assert.equal(server.pricing.extrasSubtotal, p.extrasSubtotal);
  assert.equal(server.ongoing?.perVisitPrice, client.ongoing?.perVisitPrice);
});
