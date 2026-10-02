// Promotion financial impact — INTERNAL owner review tool (proposed programs).
//
// Models the prepared promotional programs against representative homes and
// prints contribution, owner-labor-floor coverage, and 12-month recurring
// revenue. Every program is DISABLED in production; this script injects the
// proposed terms so the owner can compare them before approval.
//
// Usage: npm run promotions:impact
//
// ASSUMPTIONS (must stay explicit):
//  - Owner labor floor = estimated labor hours × ownerLaborTargetPerHour.
//    It excludes supplies, vehicle wear/gas beyond the embedded travel
//    adjustment, insurance, software and taxes — those are currently unknown
//    per-job figures and are NOT modeled.
//  - 12-month recurring revenue assumes visits actually continue for a year
//    and the customer stays at the discounted rate only for the discount
//    duration where one is stated.
//  - Prices come from the same calculateEstimate engine customers see.

import { calculateEstimate } from '../src/lib/estimate/calculate.ts';
import { pricing, pricingValue } from '../src/config/pricing.ts';
import { travelConfig } from '../src/config/travel.ts';

const ownerTarget = pricingValue(pricing.laborEconomics.ownerLaborTargetPerHour);
const minimumJob = pricingValue(pricing.minimumJob);
const todayIso = new Date().toISOString().slice(0, 10);

const baseTravel = {
  includedOneWayMiles: travelConfig.includedOneWayMiles,
  mpg: travelConfig.mpg,
  wearPerMile: travelConfig.wearPerMile,
  referenceGasPrice: travelConfig.fallbackGasPrice,
  zoneAdjustments: {
    core: pricingValue(pricing.travel.zoneAdjustments.core),
    surrounding: pricingValue(pricing.travel.zoneAdjustments.surrounding),
  },
  maxInstantDistanceMiles: travelConfig.maxInstantDistanceMiles,
};

const baseHome = {
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
};

const visitsPerYear = { weekly: 52, biweekly: 26, monthly: 12, one_time: 1 };

function quote(input, promotions = {}) {
  const result = calculateEstimate(input, { travel: baseTravel, promotions: { todayIso, ...promotions } });
  if (result.status !== 'estimated' || result.pricing.subtotal === null) return null;
  const total = Math.round((result.pricing.subtotal + result.pricing.roundingAdjustment) * 100) / 100;
  const ownerLaborFloor = Math.round(result.laborHours * ownerTarget * 100) / 100;
  return {
    total,
    laborHours: result.laborHours,
    ownerLaborFloor,
    contribution: Math.round((total - ownerLaborFloor) * 100) / 100,
    discount: result.pricing.discount,
  };
}

function line(label, before, after, frequency = 'one_time') {
  const delta = Math.round((before.total - after.total) * 100) / 100;
  const yearBefore = Math.round(before.total * visitsPerYear[frequency] * 100) / 100;
  const yearAfter = Math.round(after.total * visitsPerYear[frequency] * 100) / 100;
  console.log(`\n${label}`);
  console.log(`  price:            $${before.total.toFixed(2)} -> $${after.total.toFixed(2)}   (concession $${delta.toFixed(2)}${after.discount ? `, ${after.discount.label}` : ''})`);
  console.log(`  labor:            ${after.laborHours.toFixed(2)} h | owner labor floor $${after.ownerLaborFloor.toFixed(2)}`);
  console.log(`  contribution:     $${after.contribution.toFixed(2)} above the owner labor floor (excl. supplies/overhead)`);
  console.log(`  12-mo revenue:    $${yearBefore.toFixed(2)} -> $${yearAfter.toFixed(2)} at ${visitsPerYear[frequency]} visits/yr`);
}

const firstCleanPromotion = {
  foundingTen: {
    enabled: true,
    mechanism: 'first_clean_discount',
    firstClean: { kind: 'percent', value: 0.15, maxDiscountUsd: 40 },
    recurring: { kind: 'percent', value: null, maxDiscountUsd: null, durationMonths: null, qualifyingFrequencies: [] },
    upgrade: { addonIds: [], maxValueUsd: null, appliesToFrequencies: [] },
    capacity: { slots: 10, enforcement: 'owner_manual', awardedCount: null },
    reservationRequired: true,
    expiresOn: null,
  },
  customerKind: 'new',
};

const recurringPromotion = {
  foundingTen: {
    enabled: true,
    mechanism: 'recurring_discount',
    firstClean: { kind: 'percent', value: null, maxDiscountUsd: null },
    recurring: { kind: 'percent', value: 0.1, maxDiscountUsd: 25, durationMonths: 6, qualifyingFrequencies: ['weekly', 'biweekly'] },
    upgrade: { addonIds: [], maxValueUsd: null, appliesToFrequencies: [] },
    capacity: { slots: 10, enforcement: 'owner_manual', awardedCount: null },
    reservationRequired: true,
    expiresOn: null,
  },
};

const upgradePromotion = {
  foundingTen: {
    enabled: true,
    mechanism: 'complimentary_upgrade',
    firstClean: { kind: 'percent', value: null, maxDiscountUsd: null },
    recurring: { kind: 'percent', value: null, maxDiscountUsd: null, durationMonths: null, qualifyingFrequencies: [] },
    upgrade: { addonIds: ['inside_oven'], maxValueUsd: 35, appliesToFrequencies: [] },
    capacity: { slots: 10, enforcement: 'owner_manual', awardedCount: null },
    reservationRequired: true,
    expiresOn: null,
  },
};

const recurringAppreciation = {
  appreciationDiscounts: [
    {
      id: 'appreciation-established-recurring',
      enabled: true,
      kind: 'percent',
      value: 0.08,
      appliesTo: 'total',
      eligibility: { services: ['standard'], frequencies: ['weekly', 'biweekly', 'monthly'], customer: 'established_recurring' },
      maxDiscountUsd: 20,
      expiresOn: null,
      stackable: false,
    },
  ],
  customerKind: 'established_recurring',
};

const kitchenBundle = {
  addonBundles: [
    {
      id: 'bundle-kitchen-refresh',
      label: 'Kitchen refresh bundle (proposed 8%)',
      enabled: true,
      requiredAddonIds: ['inside_fridge', 'inside_oven'],
      eligibleFrequencies: [],
      requiresRecurring: false,
      kind: 'percent',
      value: 0.08,
      maxDiscountUsd: 20,
      expiresOn: null,
      stackable: false,
    },
  ],
};

console.log('Promotion financial impact — PROPOSED programs, all disabled in production');
console.log(`  owner labor target $${ownerTarget}/hr | minimum job $${minimumJob} | generated ${todayIso}`);

console.log('\n══ Founding 10 — mechanism comparison ══');
const oneTime = quote(baseHome);
line('Mechanism 1: 15% off the first clean (cap $40), one-time standard', oneTime, quote(baseHome, firstCleanPromotion));
const biweekly = quote({ ...baseHome, frequency: 'biweekly' });
line('Mechanism 2: 10% off ongoing recurring (cap $25, 6 months), biweekly', biweekly, quote({ ...baseHome, frequency: 'biweekly' }, recurringPromotion), 'biweekly');
line('Mechanism 3: complimentary oven add-on (about $35 value), one-time', oneTime, quote({ ...baseHome, addonIds: ['inside_oven'] }, upgradePromotion));

console.log('\n══ Appreciation discount ══');
line('Established recurring: 8% off the visit (cap $20), biweekly', biweekly, quote({ ...baseHome, frequency: 'biweekly' }, recurringAppreciation), 'biweekly');

console.log('\n══ Add-on bundles ══');
const withKitchen = quote({ ...baseHome, addonIds: ['inside_fridge', 'inside_oven'] });
line('Kitchen refresh bundle: 8% off the eligible add-on subtotal (cap $20)', withKitchen, quote({ ...baseHome, addonIds: ['inside_fridge', 'inside_oven'] }, kitchenBundle));

console.log('\n══ Safeguard summary ══');
console.log('  - Single promotion per quote; no stacking across programs or with the multi-add-on incentive.');
console.log('  - Discount base excludes specialty/custom-quote work; the minimum-job floor always wins.');
console.log('  - First-time programs fail closed until the flow can prove a new customer; the owner approves each Founding enrollment.');
console.log('  - A 12-month projection is not a promise; retention, supplies, insurance and overhead remain unmodeled assumptions.');
