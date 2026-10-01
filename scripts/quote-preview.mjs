// Reference quote preview — owner-facing economic impact check.
//
// Prints the estimator's current output for representative properties using
// the live configuration in src/config/pricing.ts and src/config/geography.ts.
// No changes are made; run it before and after editing pricing settings to see
// exactly what a change does.
//
// Usage: npm run estimate:quotes
//
// This is an INTERNAL tool. It prints internal math (rates, labor hours);
// never paste its raw output into public marketing material.

import { calculateEstimate } from '../src/lib/estimate/calculate.ts';
import { pricing, pricingValue } from '../src/config/pricing.ts';
import { zoneForZip } from '../src/config/geography.ts';

const context = {
  travel: {
    includedOneWayMiles: pricingValue(pricing.travel.includedOneWayMiles),
    mpg: pricingValue(pricing.travel.clientDefaults.mpg),
    wearPerMile: pricingValue(pricing.travel.perMileWearCost),
    referenceGasPrice: pricingValue(pricing.travel.fallbackGasPrice),
    zoneAdjustments: {
      core: pricingValue(pricing.travel.zoneAdjustments.core),
      surrounding: pricingValue(pricing.travel.zoneAdjustments.surrounding),
    },
    maxInstantDistanceMiles: pricingValue(pricing.travel.clientDefaults.maxInstantDistanceMiles),
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
  ['Studio / 1BR 700 sqft — one-time', { squareFeet: 700, bedrooms: 1, fullBaths: 1, propertyType: 'apartment' }],
  ['2BR / 1BA 1100 sqft — biweekly', { squareFeet: 1100, bedrooms: 2, fullBaths: 1, frequency: 'biweekly' }],
  ['3BR / 2BA 1600 sqft — weekly', { squareFeet: 1600, bedrooms: 3, fullBaths: 2, frequency: 'weekly' }],
  ['3BR / 2BA 1600 sqft — biweekly', { squareFeet: 1600, bedrooms: 3, fullBaths: 2, frequency: 'biweekly' }],
  ['3BR / 2BA 1600 sqft — one-time', {}],
  ['3BR / 2BA 1600 sqft — first clean (never professional)', { lastClean: 'never_professional' }],
  ['3BR / 2BA 1600 sqft — deep clean', { serviceType: 'deep', condition: 'average' }],
  ['3BR / 2BA 1600 sqft — move-out', { serviceType: 'move_in_out', condition: 'average' }],
  ['4BR / 3BA 2400 sqft — deep clean', { serviceType: 'deep', condition: 'average', squareFeet: 2400, bedrooms: 4, fullBaths: 3 }],
  ['STR 2BR / 2BA 1200 sqft — turnover', { serviceType: 'str_turnover', squareFeet: 1200, bedrooms: 2, beds: 2, condition: 'average' }],
  ['3BR / 2BA 1600 sqft — Pace (surrounding ZIP)', { zip: '32571' }],
  ['3BR / 2BA 1600 sqft — Atmore AL (extended ZIP)', { zip: '36502' }],
  ['3BR / 2BA 1600 sqft — distant/unknown ZIP', { zip: '30301' }],
];

console.log('Reference quotes — current configuration');
console.log(
  `  gross rate/labor-hr: $${pricingValue(pricing.laborEconomics.targetGrossRevenuePerLaborHour)}` +
    ` | owner labor target: $${pricingValue(pricing.laborEconomics.ownerLaborTargetPerHour)}/hr` +
    ` | minimum job: $${pricingValue(pricing.minimumJob)}` +
    ` | rounding: $${pricingValue(pricing.rounding.toNearest)}`,
);
console.log('');

const rows = scenarios.map(([label, overrides]) => {
  const input = { ...base, ...overrides };
  const result = calculateEstimate(input, context);
  return {
    scenario: label,
    zone: zoneForZip(input.zip ?? ''),
    laborHours: result.laborHours !== null ? result.laborHours.toFixed(2) : '-',
    expected: result.expectedPrice !== null ? `$${result.expectedPrice.toFixed(0)}` : 'custom',
    range: result.low !== null ? `$${result.low} – $${result.high}` : 'confirmation',
    status: result.status,
    flags: result.flags.map((flag) => flag.code).join(',') || '-',
  };
});

const widths = {
  scenario: Math.max(...rows.map((row) => row.scenario.length)),
  zone: Math.max(...rows.map((row) => row.zone.length)),
  status: Math.max(...rows.map((row) => row.status.length)),
  flags: Math.max(...rows.map((row) => row.flags.length)),
};

for (const row of rows) {
  console.log(
    [
      row.scenario.padEnd(widths.scenario),
      row.zone.padEnd(widths.zone),
      row.laborHours.padStart(5),
      row.expected.padStart(8),
      row.range.padStart(16),
      row.status.padEnd(widths.status),
      row.flags.padEnd(widths.flags),
    ].join('  '),
  );
}

console.log('\nThese are internal reference numbers; public pages never print rates or labor hours.');
