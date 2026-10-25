// Commercial / church calibration planner — Initiative 6.0 §17.
//
// Runs representative HYPOTHETICAL facility scenarios through the shared
// workload model and prints the labour economics the owner needs before
// enabling numeric facility pricing. These are planning scenarios, NOT
// completed jobs, and no result is published on the website while
// commercialTiers.numericEstimatesEnabled is false.
//
// Run: npm run commercial:calibration

import { COMMERCIAL_ECONOMICS } from '../src/config/commercial-tiers.ts';
import { pricing } from '../src/config/pricing.ts';
import { calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';

const rate = COMMERCIAL_ECONOMICS.laborRatePerHour;
const minimum = COMMERCIAL_ECONOMICS.minimumJob;
const rounding = COMMERCIAL_ECONOMICS.roundingStep;

const scenarios = [
  ['Small office', 1200, 2, false, 'maintained', 'low', 'weekly'],
  ['Medium office', 3500, 4, true, 'average', 'average', 'weekly'],
  ['Large office', 9000, 8, true, 'average', 'average', 'weekly'],
  ['Retail', 2500, 2, false, 'average', 'high', 'weekly'],
  ['Salon', 1400, 2, false, 'average', 'high', 'weekly'],
  ['Fitness studio', 4000, 4, false, 'average', 'high', 'weekly'],
  ['Multi-restroom facility', 3000, 8, true, 'needs_attention', 'high', 'weekly'],
  ['Small church', 3000, 3, true, 'maintained', 'low', 'weekly'],
  ['Medium church', 8000, 6, true, 'average', 'average', 'weekly'],
  ['Large multi-space church', 18000, 12, true, 'average', 'average', 'weekly'],
  ['High-traffic common areas', 2200, 4, false, 'heavy', 'high', 'daily'],
  ['Recurring multi-day schedule', 6000, 5, true, 'average', 'average', 'weekly'],
];

const format = (value) => `$${value.toLocaleString('en-US')}`;
const rows = [];

for (const [name, sqft, restrooms, breakroom, condition, traffic] of scenarios) {
  const workload = calculateFacilityWorkload({
    cleanableSqft: sqft,
    restrooms,
    breakroom,
    condition,
    traffic,
  });
  const raw = workload.laborHours * rate;
  const gross = Math.max(minimum, Math.round(raw / rounding) * rounding);
  const profit = gross - workload.laborHours * pricing.laborEconomics.ownerLaborTargetPerHour.value;
  rows.push({
    scenario: name,
    sqft,
    restrooms,
    condition,
    traffic,
    hours: workload.laborHours,
    gross,
    ownerProfit: Math.round(profit),
    marginPct: gross > 0 ? Math.round((profit / gross) * 100) : 0,
    tier: workload.tier,
  });
}

console.log('HYPOTHETICAL facility calibration (not completed jobs; numeric pricing remains gated)\n');
console.log(
  ['Scenario', 'Sqft', 'Restr.', 'Cond.', 'Traffic', 'Labour h', 'Gross', 'Owner profit', 'Margin', 'Tier']
    .map((label, index) => label.padEnd([28, 7, 7, 8, 8, 9, 8, 13, 7, 5][index]))
    .join(''),
);
for (const row of rows) {
  console.log(
    [
      row.scenario,
      String(row.sqft),
      String(row.restrooms),
      row.condition,
      row.traffic,
      row.hours.toFixed(2),
      format(row.gross),
      format(row.ownerProfit),
      `${row.marginPct}%`,
      row.tier,
    ]
      .map((value, index) => String(value).padEnd([28, 7, 7, 8, 8, 9, 8, 13, 7, 5][index]))
      .join(''),
  );
}
console.log(
  `\nAssumptions: ${format(rate)} gross revenue per labour-hour, ${format(minimum)} minimum job, ` +
    `$${rounding} rounding, owner labour target $${pricing.laborEconomics.ownerLaborTargetPerHour.value}/h.`,
);
console.log('Enable numeric pricing only after the owner reviews this table and real-job calibration.');
