// Generates the committed facility-calibration report and CSV from the same
// shared model. All scenarios are hypothetical; no customer data is present.
// Run: npm run calibration:report

import fs from 'node:fs';
import path from 'node:path';

import { pricing } from '../src/config/pricing.ts';
import {
  CHURCH_SCENARIOS,
  COMMERCIAL_SCENARIOS,
  runAllCalibration,
  type FacilityCalibrationRow,
} from '../src/lib/estimate/calibration.ts';

const { commercial, church } = runAllCalibration();
const docsDir = path.resolve('docs/operations');
const verificationDir = path.resolve('docs/verification');
fs.mkdirSync(docsDir, { recursive: true });
fs.mkdirSync(verificationDir, { recursive: true });

const money = (value: number | null): string => (value === null ? '—' : `$${value.toFixed(2)}`);
const perSqft = (value: number | null): string => (value === null ? '—' : `$${value.toFixed(3)}`);

function summary(label: string, rows: FacilityCalibrationRow[]): string {
  const priced = rows.filter((row) => row.serviceRevenue !== null);
  const tiers = ['A', 'B', 'C'].map((tier) => `${tier}: ${rows.filter((row) => row.tier === tier).length}`).join(', ');
  const minimum = rows.filter((row) => row.cleaningSubtotal === pricing.minimumJob.value && row.serviceRevenue !== null).length;
  const netPct = priced.length
    ? Math.round(
        (priced.reduce((sum, row) => sum + (row.operatingProfit ?? 0), 0) /
          priced.reduce((sum, row) => sum + (row.serviceRevenue ?? 0), 0)) *
          100,
      )
    : 0;
  const sqft = priced
    .map((row) => row.effectivePerSqftPerVisit)
    .filter((value): value is number => value !== null);
  const avgSqft = sqft.length ? sqft.reduce((sum, value) => sum + value, 0) / sqft.length : 0;
  return `| ${label} | ${rows.length} | ${tiers} | ${priced.length} | ${minimum} | ${netPct}% | ${avgSqft ? `$${avgSqft.toFixed(3)}` : '—'} |`;
}

function table(rows: FacilityCalibrationRow[]): string {
  const lines = [
    '| ID | Scenario | sqft | Fixtures | Schedule | Hours | Tier | Service | Travel | Profit | $/sqft/visit | Monthly | Customer estimate |',
    '| --- | --- | ---: | ---: | --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.name} | ${row.sqft.toLocaleString('en-US')} | ${row.fixtures} | ${row.frequency}${row.visitsPerWeek > 1 ? ` ×${row.visitsPerWeek}/wk` : ''} | ${row.totalLaborHours.toFixed(2)} | ${row.tier} | ${money(row.serviceRevenue)} | ${money(row.travelCharge)} | ${money(row.operatingProfit)} | ${perSqft(row.effectivePerSqftPerVisit)} | ${money(row.monthlyEquivalent)} | ${row.customerEstimate} |`,
    );
  }
  return lines.join('\n');
}

const markdown = `# Facility pricing calibration (Initiative 6.2 completion)

**Date:** 2026-10-25
**Status:** completed initial calibration; hypothetical scenarios, not completed jobs.
**Model:** ${money(pricing.commercialPricing.grossRatePerHour.value)}/labor-hour gross;
${money(pricing.laborEconomics.ownerLaborTargetPerHour.value)}/hour owner-labour cost;
${money(pricing.minimumJob.value)} minimum; ${pricing.commercialPricing.overheadRatePercent.value}% overhead allowance;
global factor ${pricing.globalEstimateFactor.value.toFixed(2)}.

## Method

- ISSA-style workloading: area ÷ production rate + setup + fixture minutes +
  breakroom, then flooring, condition, traffic and first-clean factors.
- All rows use the **same shared functions** used by the website and
  \`facility-verify.ts\`; they are not a separate spreadsheet.
- The church discount is applied after the $125 minimum and the $5 facility
  presentation step, then retained to the cent. The global owner factor applies
  after the discount and never to travel.
- Tier A = one preliminary number; Tier B = ±15% range; Tier C = custom review
  with no invented number. Specialty work is always custom.
- Travel is a separately stated pass-through; it is excluded from the
  operating-profit calculation. Monthly equivalents use the scenario's visits
  per week and are not per-visit prices.
- **Do not compare per-visit and monthly $/sqft as the same unit.** The local
  market references used in research have ambiguous units; the calibration
  reports effective per-visit $/sqft and monthly equivalent separately.

## Summary

| Engine | Scenarios | Tiers | Numeric | Minimum-floor | Aggregate operating margin | Average per-visit $/sqft |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
${summary('Commercial', commercial)}
${summary('Church (10% discount)', church)}

The modelled margin is operating profit after owner-labour cost and the 22%
overhead allowance; it is not a promise of net profit. Minimum-floor rows are
valid small-job outcomes, not pricing defects. Tier C/specialty rows are
deliberately excluded from revenue and profit figures because no price is
offered; their labour estimate remains visible for planning.

## Commercial scenario matrix

${table(commercial)}

## Church scenario matrix (10% discount applied)

${table(church)}

## Findings

1. Ordinary Tier A/B commercial scenarios are numeric and positive after labour
   and overhead; Tier B spans roughly 3–8 labour hours.
2. Higher-restroom, larger or specialty scopes correctly become custom reviews
   rather than misleading numbers.
3. Ordinary church scenarios use the exact 10% discount. Example:
   $145.00 − $14.50 = $130.50. No upward re-rounding occurs.
4. The owner global factor scales service revenue without changing the church
   discount or travel charge; the shared tests cover 0.90/1.00/1.10.
5. Travel is visible separately (c25 and h20); it is not discounted.
6. The model is deliberately conservative on production rates and uses a
   $60/hour gross rate within the researched local $50–75/hour band. No rate
   change was made merely to make the matrix look better.

## Limitations

- These are research-based simulations, not completed jobs. Actual job hours
  should be monitored as a quality check; that monitoring is not a prerequisite
  to using the calibrated model.
- Market $/sqft references are not a single comparable unit; the report avoids
  that false comparison.
- Tier B is an uncertainty band, not a guaranteed range; travel, condition and
  access can change the final scope.
- Specialty, high-fixture and very large projects remain owner-reviewed.
- The CSV contains all calculated fields, including setup/fixture/breakroom
  labour split, labour cost, overhead, contribution and reconciliation.
`;

fs.writeFileSync(path.join(docsDir, 'FACILITY-CALIBRATION.md'), markdown, 'utf8');

const columns = [
  'id',
  'name',
  'kind',
  'sqft',
  'fixtures',
  'frequency',
  'visitsPerWeek',
  'areaHours',
  'setupHours',
  'fixtureHours',
  'breakroomHours',
  'totalLaborHours',
  'laborCost',
  'cleaningSubtotal',
  'discount',
  'globalAdjustment',
  'serviceRevenue',
  'travelCharge',
  'totalPerVisit',
  'monthlyEquivalent',
  'overhead',
  'contributionAfterLabor',
  'operatingProfit',
  'effectivePerSqftPerVisit',
  'customerEstimate',
  'tier',
  'uncertainty',
  'specialty',
  'reconciliation',
  'note',
];
const escapeCsv = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = [
  columns.join(','),
  ...[...commercial, ...church].map((row) =>
    columns.map((column) => escapeCsv(row[column as keyof FacilityCalibrationRow])).join(','),
  ),
].join('\n');
fs.writeFileSync(path.join(verificationDir, 'FACILITY-CALIBRATION-2026-10-25.csv'), csv + '\n', 'utf8');

if (COMMERCIAL_SCENARIOS.length < 25 || CHURCH_SCENARIOS.length < 20) {
  throw new Error('Calibration matrix is below the required scenario count');
}
console.log(`Wrote ${COMMERCIAL_SCENARIOS.length} commercial + ${CHURCH_SCENARIOS.length} church scenarios.`);
console.log('docs/operations/FACILITY-CALIBRATION.md');
console.log('docs/verification/FACILITY-CALIBRATION-2026-10-25.csv');
