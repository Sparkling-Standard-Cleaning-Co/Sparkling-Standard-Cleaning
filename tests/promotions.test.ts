// Promotion engine tests — owner gating, eligibility, caps, expiry, no
// stacking, minimum-job protection, specialty exclusion, and frontend/server
// consistency. All shipped programs are DISABLED; tests inject explicit
// overrides to exercise each mechanism without changing customer behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pricing } from '../src/config/pricing.ts';
import { ownerPricing } from '../src/config/owner-pricing.ts';
import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { evaluatePromotions, type PromotionInput } from '../src/lib/estimate/promotions.ts';
import { mapReservationFields } from '../src/lib/estimate/verify.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

const baseInput: PromotionInput = {
  serviceType: 'standard',
  frequency: 'one_time',
  eligibleAddonIds: ['inside_oven', 'laundry'],
  addonChargesById: { inside_oven: 30, laundry: 35 },
  addonSubtotal: 50,
  gross: 200,
  minimumJob: 125,
  todayIso: '2026-10-02',
  customerKind: 'unknown',
  addonIncentive: { enabled: false, tiers: [], maxDiscount: null },
  appreciationDiscounts: [],
  addonBundles: [],
  foundingTen: {
    enabled: false,
    mechanism: null,
    firstClean: { kind: 'percent', value: null, maxDiscountUsd: null },
    recurring: { kind: 'percent', value: null, maxDiscountUsd: null, durationMonths: null, qualifyingFrequencies: [] },
    upgrade: { addonIds: [], maxValueUsd: null, appliesToFrequencies: [] },
    capacity: { slots: 10, enforcement: 'owner_manual', awardedCount: null },
    reservationRequired: true,
    expiresOn: null,
  },
};

function overrides(partial: Partial<PromotionInput>): PromotionInput {
  return { ...baseInput, ...partial };
}

// ── Shipped state ─────────────────────────────────────────────────────────────

test('every shipped promotion program is disabled with no terms', () => {
  for (const program of pricing.promotions.appreciationDiscounts) {
    assert.equal(program.enabled, false, `${program.id} must stay disabled`);
    assert.equal(program.value, null, `${program.id} must have no unapproved value`);
    assert.equal(program.maxDiscountUsd, null, `${program.id} must have no unapproved cap`);
  }
  for (const bundle of pricing.promotions.addonBundles) {
    assert.equal(bundle.enabled, false, `${bundle.id} must stay disabled`);
    assert.equal(bundle.value, null, `${bundle.id} must have no unapproved value`);
  }
  assert.equal(pricing.promotions.foundingTen.enabled, false);
  assert.equal(pricing.promotions.foundingTen.mechanism, null, 'the owner has not chosen a mechanism');
  assert.equal(pricing.promotions.foundingTen.capacity.awardedCount, null, 'no slot count is claimed');
  assert.equal(pricing.promotions.foundingTen.capacity.enforcement, 'owner_manual');
  assert.equal(pricing.promotions.foundingTen.reservationRequired, true);
});

test('no discount ever applies in the shipped configuration', () => {
  const evaluation = evaluatePromotions(baseInput);
  assert.equal(evaluation.discount, null);

  const context: EstimateContext = {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
    },
  };
  const input: EstimateInput = {
    serviceType: 'standard',
    propertyType: 'house',
    squareFeet: 1600,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 0,
    frequency: 'one_time',
    condition: 'maintained',
    lastClean: 'within_month',
    addonIds: ['inside_oven', 'laundry'],
    zip: '32503',
    pets: 'none',
  };
  const result = calculateEstimate(input, context);
  assert.equal(result.status, 'estimated');
  assert.equal(result.pricing.discount, null);
});

// ── Bundles ───────────────────────────────────────────────────────────────────

const kitchenBundle = {
  id: 'bundle-test-kitchen',
  label: 'Kitchen refresh bundle',
  enabled: true,
  requiredAddonIds: ['inside_oven'],
  eligibleFrequencies: [] as Array<'weekly' | 'biweekly' | 'monthly' | 'one_time'>,
  requiresRecurring: false,
  kind: 'percent' as const,
  value: 0.1,
  maxDiscountUsd: 20,
  expiresOn: null,
  stackable: false as const,
};

test('a bundle applies only when every required add-on is selected', () => {
  const applied = evaluatePromotions(overrides({ addonBundles: [kitchenBundle] }));
  assert.equal(applied.discount?.id, 'bundle-test-kitchen');
  assert.equal(applied.discount?.amount, 5, '10% of the $50 add-on subtotal');

  const missing = evaluatePromotions(
    overrides({ eligibleAddonIds: ['laundry'], addonBundles: [kitchenBundle] }),
  );
  assert.equal(missing.discount, null);
});

test('bundle caps and frequency requirements are enforced', () => {
  const capped = evaluatePromotions(
    overrides({ addonSubtotal: 500, addonBundles: [{ ...kitchenBundle, maxDiscountUsd: 20 }] }),
  );
  assert.equal(capped.discount?.amount, 20, 'cap wins over the percent');

  const recurringOnly = evaluatePromotions(
    overrides({ frequency: 'one_time', addonBundles: [{ ...kitchenBundle, requiresRecurring: true }] }),
  );
  assert.equal(recurringOnly.discount, null, 'one-time work cannot claim a recurring bundle');

  const wrongFrequency = evaluatePromotions(
    overrides({ frequency: 'weekly', addonBundles: [{ ...kitchenBundle, eligibleFrequencies: ['biweekly'] }] }),
  );
  assert.equal(wrongFrequency.discount, null);
});

test('an expired program never applies', () => {
  const expired = evaluatePromotions(
    overrides({ addonBundles: [{ ...kitchenBundle, expiresOn: '2026-09-01' }] }),
  );
  assert.equal(expired.discount, null);
  const active = evaluatePromotions(
    overrides({ addonBundles: [{ ...kitchenBundle, expiresOn: '2026-11-01' }] }),
  );
  assert.equal(active.discount?.id, 'bundle-test-kitchen');
});

// ── Appreciation discounts ────────────────────────────────────────────────────

const appreciationNew = {
  id: 'appreciation-test-new',
  enabled: true,
  kind: 'percent' as const,
  value: 0.1,
  appliesTo: 'first_visit' as const,
  eligibility: { services: ['standard'], frequencies: ['weekly', 'biweekly'], customer: 'new' as const },
  maxDiscountUsd: 40,
  expiresOn: null,
  stackable: false as const,
};

test('customer-kind programs fail closed until the flow can prove the customer', () => {
  const unknown = evaluatePromotions(overrides({ appreciationDiscounts: [appreciationNew] }));
  assert.equal(unknown.discount, null, 'unknown customer cannot claim a new-customer program');

  const known = evaluatePromotions(
    overrides({ customerKind: 'new', frequency: 'biweekly', appreciationDiscounts: [appreciationNew] }),
  );
  assert.equal(known.discount?.id, 'appreciation-test-new');
  assert.equal(known.discount?.amount, 20, '10% of the $200 quote before travel');
});

test('appreciation eligibility respects service and frequency lists', () => {
  const wrongService = evaluatePromotions(
    overrides({ customerKind: 'new', frequency: 'biweekly', serviceType: 'deep', appreciationDiscounts: [appreciationNew] }),
  );
  assert.equal(wrongService.discount, null);
  const wrongFrequency = evaluatePromotions(
    overrides({ customerKind: 'new', frequency: 'monthly', appreciationDiscounts: [appreciationNew] }),
  );
  assert.equal(wrongFrequency.discount, null);
});

// ── Founding-10 mechanisms ────────────────────────────────────────────────────

test('founding first-clean discount requires a proven new customer', () => {
  const config = {
    ...baseInput.foundingTen,
    enabled: true,
    mechanism: 'first_clean_discount' as const,
    firstClean: { kind: 'percent' as const, value: 0.15, maxDiscountUsd: 60 },
  };
  const unknown = evaluatePromotions(overrides({ foundingTen: config }));
  assert.equal(unknown.discount, null);
  const known = evaluatePromotions(overrides({ customerKind: 'new', foundingTen: config }));
  assert.equal(known.discount?.id, 'founding-ten-first-clean');
  assert.equal(known.discount?.amount, 30);
});

test('founding recurring discount applies only to qualifying rhythms', () => {
  const config = {
    ...baseInput.foundingTen,
    enabled: true,
    mechanism: 'recurring_discount' as const,
    recurring: {
      kind: 'percent' as const,
      value: 0.1,
      maxDiscountUsd: 25,
      durationMonths: 6,
      qualifyingFrequencies: ['weekly', 'biweekly'] as Array<'weekly' | 'biweekly'>,
    },
  };
  const oneTime = evaluatePromotions(overrides({ foundingTen: config }));
  assert.equal(oneTime.discount, null);
  const biweekly = evaluatePromotions(overrides({ frequency: 'biweekly', foundingTen: config }));
  assert.equal(biweekly.discount?.id, 'founding-ten-recurring');
  assert.equal(biweekly.discount?.amount, 20);
});

test('the complimentary-upgrade mechanism waives the granted add-on, capped', () => {
  const config = {
    ...baseInput.foundingTen,
    enabled: true,
    mechanism: 'complimentary_upgrade' as const,
    upgrade: { addonIds: ['inside_oven'], maxValueUsd: 30, appliesToFrequencies: [] },
  };
  const evaluation = evaluatePromotions(overrides({ foundingTen: config }));
  assert.equal(evaluation.discount?.id, 'founding-ten-upgrade');
  assert.equal(evaluation.discount?.amount, 30, 'the granted oven charge is waived');
  assert.equal(evaluation.grant?.id, 'founding-ten-upgrade', 'the grant is recorded for the owner');

  const capped = evaluatePromotions(
    overrides({
      foundingTen: { ...config, upgrade: { ...config.upgrade, maxValueUsd: 10 } },
    }),
  );
  assert.equal(capped.discount?.amount, 10, 'the approved value cap wins');

  const notSelected = evaluatePromotions(
    overrides({ eligibleAddonIds: ['laundry'], foundingTen: config }),
  );
  assert.equal(notSelected.discount, null, 'a granted add-on that was not selected is not waived');
});

// ── Single-promotion policy + floors ──────────────────────────────────────────

test('at most one promotion applies — the largest effective discount wins', () => {
  const evaluation = evaluatePromotions(
    overrides({
      addonBundles: [kitchenBundle], // 10% of $50 = $5
      appreciationDiscounts: [
        { ...appreciationNew, eligibility: { services: [], frequencies: [], customer: 'any' } }, // 10% of $200 = $20
      ],
      customerKind: 'unknown',
    }),
  );
  assert.equal(evaluation.discount?.id, 'appreciation-test-new');
  assert.equal(evaluation.discount?.amount, 20);
});

test('a discount can never push a quote below the minimum job', () => {
  const tiny = evaluatePromotions(
    overrides({
      gross: 130,
      minimumJob: 125,
      addonSubtotal: 30,
      addonBundles: [{ ...kitchenBundle, value: 0.9, maxDiscountUsd: null }],
    }),
  );
  // 90% of $30 = $27, but the floor leaves only $5 of room.
  assert.equal(tiny.discount?.amount, 5);
});

test('a program with no headroom above the minimum produces no discount', () => {
  const none = evaluatePromotions(
    overrides({
      gross: 125,
      minimumJob: 125,
      addonSubtotal: 30,
      addonBundles: [kitchenBundle],
    }),
  );
  assert.equal(none.discount, null);
});

test('null or zero terms can never apply, even if enabled', () => {
  const nullTerm = evaluatePromotions(
    overrides({ addonBundles: [{ ...kitchenBundle, value: null }] }),
  );
  assert.equal(nullTerm.discount, null);
  const zeroTerm = evaluatePromotions(
    overrides({ appreciationDiscounts: [{ ...appreciationNew, value: 0 }] }),
  );
  assert.equal(zeroTerm.discount, null);
});

// ── Frontend / server consistency ────────────────────────────────────────────

test('client and server recompute the same promotion discount from the same terms', () => {
  const bundle = { ...kitchenBundle, value: 0.08, maxDiscountUsd: 15 };
  const context: EstimateContext = {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
    },
    promotions: { addonBundles: [bundle] },
  };
  const client = calculateEstimate(
    {
      serviceType: 'standard',
      propertyType: 'house',
      squareFeet: 1600,
      bedrooms: 3,
      fullBaths: 2,
      halfBaths: 0,
      frequency: 'one_time',
      condition: 'maintained',
      lastClean: 'within_month',
      addonIds: ['inside_oven', 'laundry'],
      zip: '32503',
      pets: 'none',
    },
    context,
  );
  const server = calculateEstimate(
    mapReservationFields({
      service_type: 'standard',
      property_type: 'house',
      square_feet: '1600',
      bedrooms: '3',
      full_baths: '2',
      half_baths: '0',
      frequency: 'one_time',
      condition: 'maintained',
      last_cleaned: 'within_month',
      addon_ids: 'inside_oven,laundry',
      zip: '32503',
    }),
    context,
  );
  assert.equal(client.pricing.discount?.id, 'bundle-test-kitchen');
  assert.deepEqual(server.pricing.discount, client.pricing.discount);
  assert.equal(server.pricing.subtotal, client.pricing.subtotal);
});

// ── Config integrity ──────────────────────────────────────────────────────────

test('every prepared program has a unique id and declared non-stackability', () => {
  const ids = [
    ...pricing.promotions.appreciationDiscounts.map((program) => program.id),
    ...pricing.promotions.addonBundles.map((bundle) => bundle.id),
  ];
  assert.equal(new Set(ids).size, ids.length, 'program ids must be unique');
  for (const program of pricing.promotions.appreciationDiscounts) {
    assert.equal(program.stackable, false);
  }
  for (const bundle of pricing.promotions.addonBundles) {
    assert.equal(bundle.stackable, false);
  }
  assert.equal(ownerPricing.promotions.foundingTen.capacity.slots, 10);
});
