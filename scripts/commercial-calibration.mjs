// Financial audit + calibration planner — Initiative 6.1 hardening.
// HYPOTHETICAL scenarios, not completed jobs. Shows revenue, direct labour,
// labour contribution, conservative overhead and estimated net profit.

import { pricing } from '../src/config/pricing.ts';
import { calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';

const scenarios = [
  ['1,000 sqft office', 1000, 4, false, 'maintained', 'low', 'office', 'weekly'],
  ['2,000 sqft office', 2000, 6, true, 'average', 'average', 'office', 'weekly'],
  ['2,500 sqft office', 2500, 6, true, 'average', 'average', 'office', 'weekly'],
  ['4,000 sqft office', 4000, 8, true, 'average', 'average', 'office', 'weekly'],
  ['6,000 sqft office', 6000, 10, true, 'average', 'average', 'office', 'weekly'],
  ['Small retail', 2000, 4, false, 'average', 'high', 'retail', 'weekly'],
  ['Salon', 1400, 4, false, 'average', 'high', 'salon', 'weekly'],
  ['Fitness studio', 4000, 6, false, 'average', 'high', 'gym', 'weekly'],
  ['Multi-restroom facility', 3000, 18, true, 'needs_attention', 'high', 'office', 'weekly'],
  ['Small church', 3000, 6, true, 'maintained', 'low', 'church', 'weekly'],
  ['Medium church', 8000, 12, true, 'average', 'average', 'church', 'weekly'],
  ['Large church', 18000, 24, true, 'average', 'average', 'church', 'weekly'],
  ['Church + nursery/classrooms', 9000, 14, true, 'average', 'average', 'church', 'weekly'],
  ['Fellowship hall + kitchen', 6000, 10, true, 'average', 'high', 'church', 'weekly'],
  ['Heavily soiled office', 2500, 6, true, 'heavy', 'high', 'office', 'weekly'],
  ['Monthly office', 4000, 8, true, 'average', 'average', 'office', 'monthly'],
];

const format = (value) => `$${Math.round(value).toLocaleString('en-US')}`;
const laborRate = pricing.laborEconomics.ownerLaborTargetPerHour.value;
const overheadRate = pricing.commercialPricing.overheadRatePercent.value / 100;
const rows = [];

for (const [name, sqft, fixtures, breakroom, condition, traffic, type, frequency] of scenarios) {
  const input = {
    cleanableSqft: sqft,
    restroomFixtures: fixtures,
    breakroom,
    facilityType: type,
    condition,
    traffic,
    firstClean: false,
  };
  const workload = calculateFacilityWorkload(input);
  // Internal financial model: always compute the researched economics, even
  // when the customer-facing numeric pricing switch is off.
  const price = calculateFacilityPrice(workload, frequency, {
    church: type === 'church',
    numericEstimatesEnabled: true,
  });
  const revenue = price.perVisit;
  const laborCost = workload.laborHours * laborRate;
  const laborContribution = revenue - laborCost;
  const overhead = revenue * overheadRate;
  const net = revenue - laborCost - overhead;
  rows.push({
    scenario: name,
    hours: workload.laborHours,
    tier: workload.tier,
    revenue,
    laborCost,
    laborContribution,
    overhead,
    net,
    netPct: revenue > 0 ? Math.round((net / revenue) * 100) : 0,
    monthly: price.monthly,
    discount: price.discount?.amount ?? 0,
  });
}

console.log('HYPOTHETICAL facility scenarios — research-based, not completed jobs\n');
console.log(
  'Scenario'.padEnd(29) +
    'Hrs'.padEnd(6) +
    'Tier'.padEnd(5) +
    'Revenue'.padEnd(9) +
    'Labor'.padEnd(8) +
    'Contrib.'.padEnd(9) +
    'Overhead'.padEnd(9) +
    'Net'.padEnd(7) +
    'Net%'.padEnd(6) +
    'Monthly',
);
for (const row of rows) {
  console.log(
    row.scenario.padEnd(29) +
      row.hours.toFixed(2).padEnd(6) +
      row.tier.padEnd(5) +
      format(row.revenue).padEnd(9) +
      format(row.laborCost).padEnd(8) +
      format(row.laborContribution).padEnd(9) +
      format(row.overhead).padEnd(9) +
      format(row.net).padEnd(7) +
      `${row.netPct}%`.padEnd(6) +
      (row.monthly ? format(row.monthly) : '—'),
  );
}
console.log(
  `\nRate: ${format(pricing.commercialPricing.grossRatePerHour.value)}/hr gross · minimum ${format(pricing.minimumJob.value)} · owner labour ${format(laborRate)}/hr · overhead ${Math.round(overheadRate * 100)}% of revenue (travel additional) · prices round UP to $${pricing.rounding.toNearest.value}`,
);
console.log('Church rows include the 10% discount in revenue. Labour contribution is NOT profit.');
