// Multi-add-on incentive — owner impact report (PROPOSED promotion).
//
// Compares reference quotes with the incentive OFF (current published state)
// and ON (proposed tiers: 2 add-ons 5%, 3+ add-ons 8%, single tier only),
// then checks the profitability safeguards: the discounted total must stay at
// or above the minimum job value, the base cleaning price, the owner's labor
// compensation target, and the travel cost already embedded in the quote.
//
// Usage: npm run estimate:discount-impact
//
// INTERNAL tool: prints internal math (rates, labor hours, targets). Never
// paste raw output into public marketing material, and do not enable the
// promotion without owner approval of this report.

import { calculateEstimate } from '../src/lib/estimate/calculate.ts';
import { pricing, pricingValue } from '../src/config/pricing.ts';
import { travelConfig } from '../src/config/travel.ts';

const tiers = pricing.addonIncentive.tiers.map((tier) => ({
  minAddons: tier.minAddons,
  percent: tier.percent.value,
}));
const maxDiscount = pricing.addonIncentive.maxDiscount.value;
const ownerTarget = pricingValue(pricing.laborEconomics.ownerLaborTargetPerHour);
const minimumJob = pricingValue(pricing.minimumJob);
const step = pricingValue(pricing.rounding.toNearest);

const baseContext = {
  travel: {
    includedOneWayMiles: travelConfig.includedOneWayMiles,
    mpg: travelConfig.mpg,
    wearPerMile: travelConfig.wearPerMile,
    referenceGasPrice: travelConfig.fallbackGasPrice,
    zoneAdjustments: {
      core: pricingValue(pricing.travel.zoneAdjustments.core),
      surrounding: pricingValue(pricing.travel.zoneAdjustments.surrounding),
    },
    maxInstantDistanceMiles: travelConfig.maxInstantDistanceMiles,
  },
};

const base = {
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

const scenarios = [
  ['3/2 one-time + oven', { addonIds: ['inside_oven'] }],
  ['3/2 one-time + oven + laundry', { addonIds: ['inside_oven', 'laundry'] }],
  ['3/2 one-time + 3 add-ons', { addonIds: ['inside_oven', 'laundry', 'dishes'] }],
  ['3/2 one-time + 4 add-ons', { addonIds: ['inside_oven', 'laundry', 'dishes', 'inside_fridge'] }],
  ['3/2 weekly (recurring) + 2 add-ons', { frequency: 'weekly', addonIds: ['inside_oven', 'laundry'] }],
  ['3/2 weekly (recurring) + 3 add-ons', { frequency: 'weekly', addonIds: ['inside_oven', 'laundry', 'dishes'] }],
];

const context = (enabled) => ({
  ...baseContext,
  addonIncentive: enabled ? { enabled: true, tiers, maxDiscount } : { enabled: false, tiers, maxDiscount },
});

function total(result) {
  const p = result.pricing;
  return Math.round((p.subtotal + p.roundingAdjustment) * 100) / 100;
}

function extrasOf(result) {
  return result.pricing.selectedExtras
    .map((extra) => `${extra.label} $${extra.charge.toFixed(2)}`)
    .join(', ') || 'None';
}

console.log('Multi-add-on incentive — reference impact report (PROPOSED, not published)');
console.log(
  `  tiers: ${tiers.map((tier) => `${tier.minAddons}+ -> ${Math.round(tier.percent * 100)}%`).join(' | ')}` +
    ` | cap: $${maxDiscount} | owner labor target: $${ownerTarget}/hr | minimum: $${minimumJob}`,
);
console.log('');

const problems = [];
for (const [label, overrides] of scenarios) {
  const input = { ...base, ...overrides };
  const before = calculateEstimate(input, context(false));
  const after = calculateEstimate(input, context(true));
  if (before.status !== 'estimated' || after.status !== 'estimated') {
    console.log(`${label}: requires personal confirmation — no instant quote to compare`);
    continue;
  }
  const beforeTotal = total(before);
  const afterTotal = total(after);
  const p = after.pricing;
  const discount = p.discount?.amount ?? 0;
  const eligibleCount = after.pricing.selectedExtras.length;
  const expectedTier = [...tiers].sort((a, b) => b.minAddons - a.minAddons).find((t) => eligibleCount >= t.minAddons);
  const expectedPercent = eligibleCount >= 2 && expectedTier ? expectedTier.percent : 0;
  const safetyFloor = Math.max(
    minimumJob,
    Math.round(after.laborHours * ownerTarget * 100) / 100,
    p.basePrice,
  );
  const checks = [
    ['single tier applied', p.discount ? p.discount.percent === expectedPercent : discount === 0],
    ['discount <= cap', discount <= maxDiscount],
    ['discount <= extras', discount <= p.extrasSubtotal + 0.001],
    ['total >= minimum+base floor', afterTotal + 0.001 >= safetyFloor],
    ['total >= undiscounted extras price floor', afterTotal > beforeTotal - before.pricing.extrasSubtotal - 0.001],
    ['rounded to the nearest step', Math.abs(afterTotal / step - Math.round(afterTotal / step)) < 1e-9],
  ];
  for (const [name, ok] of checks) {
    if (!ok) problems.push(`${label}: ${name}`);
  }
  console.log(`${label}`);
  console.log(`  before: $${beforeTotal.toFixed(2)}  (base $${before.pricing.basePrice.toFixed(2)}, extras ${extrasOf(before)})`);
  console.log(
    `  after:  $${afterTotal.toFixed(2)}  (base $${p.basePrice.toFixed(2)}, extras $${p.extrasSubtotal.toFixed(2)},` +
      ` discount -$${discount.toFixed(2)}${p.discount ? ` [${p.discount.label}]` : ''}, rounding +$${p.roundingAdjustment.toFixed(2)})`,
  );
  console.log(
    `  customer saves: $${discount.toFixed(2)} | labor ${after.laborHours.toFixed(2)}h | safety floor $${safetyFloor.toFixed(2)}` +
      ` | checks: ${checks.every(([, ok]) => ok) ? 'PASS' : 'FAIL'}`,
  );
  console.log('');
}

if (problems.length > 0) {
  console.error('SAFEGUARD FAILURES:');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log('All safeguard checks passed. Publication still requires explicit owner approval.');
