// Facility pricing calibration — hypothetical, research-based scenarios.
// Not completed customer jobs. The same shared engine used by the website and
// server verifier is exercised across the matrix. Run:
//   npm run commercial:calibration
//   npm run commercial:calibration -- --json

import { pricing } from '../src/config/pricing.ts';
import {
  CHURCH_SCENARIOS,
  COMMERCIAL_SCENARIOS,
  runAllCalibration,
  type FacilityCalibrationRow,
} from '../src/lib/estimate/calibration.ts';

const wantsJson = process.argv.includes('--json');
const { commercial, church } = runAllCalibration();
const all = [...commercial, ...church];

if (wantsJson) {
  console.log(JSON.stringify({ commercial, church }, null, 2));
  process.exit(0);
}

function money(value: number | null): string {
  if (value === null) return '—';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(value: number, revenue: number): string {
  if (revenue <= 0) return '—';
  return `${Math.round((value / revenue) * 100)}%`;
}

function printTable(label: string, rows: FacilityCalibrationRow[]): void {
  console.log(`\n${label} (${rows.length} hypothetical scenarios)\n`);
  console.log(
    'ID   Tier Hrs  Setup Fixt. Labor   Service  Travel  Overhead Profit  $/sqft  Monthly     Customer estimate',
  );
  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(4),
        row.tier.padEnd(4),
        row.totalLaborHours.toFixed(2).padEnd(4),
        row.setupHours.toFixed(2).padEnd(5),
        row.fixtureHours.toFixed(2).padEnd(6),
        money(row.laborCost).padEnd(8),
        money(row.serviceRevenue).padEnd(8),
        money(row.travelCharge).padEnd(7),
        money(row.overhead).padEnd(8),
        money(row.operatingProfit).padEnd(7),
        row.effectivePerSqftPerVisit === null ? '—' : `$${row.effectivePerSqftPerVisit.toFixed(3)}`.padEnd(7),
        money(row.monthlyEquivalent).padEnd(11),
        row.customerEstimate,
      ].join(' '),
    );
  }
}

function summary(label: string, rows: FacilityCalibrationRow[]): void {
  const priced = rows.filter((row) => (row.serviceRevenue ?? 0) > 0);
  const tiers = ['A', 'B', 'C'].map((tier) => `${tier}:${rows.filter((row) => row.tier === tier).length}`).join(' ');
  const minApplied = rows.filter(
    (row) => row.cleaningSubtotal === pricing.minimumJob.value && (row.serviceRevenue ?? 0) > 0,
  ).length;
  const netPct = priced.length
    ? Math.round(
        (priced.reduce((sum, row) => sum + (row.operatingProfit ?? 0), 0) /
          priced.reduce((sum, row) => sum + (row.serviceRevenue ?? 0), 0)) *
          100,
      )
    : 0;
  const perSqft = priced
    .map((row) => row.effectivePerSqftPerVisit)
    .filter((value): value is number => value !== null);
  const avgSqft = perSqft.length ? perSqft.reduce((sum, value) => sum + value, 0) / perSqft.length : 0;
  console.log(
    `\n${label} summary: ${rows.length} scenarios; tiers ${tiers}; numeric ${priced.length}; minimum-floor ${minApplied}; ` +
      `aggregate operating margin ${netPct}%; average per-visit $/sqft ${avgSqft ? `$${avgSqft.toFixed(3)}` : '—'} (not a monthly benchmark).`,
  );
}

console.log('HYPOTHETICAL facility calibration — research-based, not completed jobs');
console.log(
  `Rate ${money(pricing.commercialPricing.grossRatePerHour.value)}/labor-hour; owner labour ${money(pricing.laborEconomics.ownerLaborTargetPerHour.value)}/hr; ` +
    `minimum ${money(pricing.minimumJob.value)}; overhead ${pricing.commercialPricing.overheadRatePercent.value}% of service revenue; ` +
    `global factor ${pricing.globalEstimateFactor.value.toFixed(2)}; prices round up to $${pricing.rounding.toNearest.value}.`,
);
console.log(
  'Per-visit and monthly square-foot figures are different units; do not compare them directly. ' +
    'Travel is a pass-through charge and is excluded from the operating-profit calculation.',
);

printTable('Commercial', commercial);
printTable('Church (10% discount applied)', church);
summary('Commercial', commercial);
summary('Church', church);

const reconciliationErrors = church.filter((row) => row.reconciliation.includes('ERROR'));
const discountErrors = church.filter(
  (row) => row.discount > 0 && Math.abs(row.discount - row.cleaningSubtotal * 0.1) > 0.005,
);
const invalidCounts = COMMERCIAL_SCENARIOS.length < 25 || CHURCH_SCENARIOS.length < 20;
if (invalidCounts || reconciliationErrors.length > 0 || discountErrors.length > 0) {
  console.error('\nCALIBRATION FAILED');
  if (invalidCounts) console.error('- requires at least 25 commercial and 20 church scenarios');
  if (reconciliationErrors.length > 0) console.error(`- ${reconciliationErrors.length} church reconciliation errors`);
  if (discountErrors.length > 0) console.error(`- ${discountErrors.length} church discount errors`);
  process.exit(1);
}

console.log('\nCoverage checks passed: 25+ commercial, 20 church, exact church discount cents, no reconciliation errors.');
console.log('Limitations: model uncertainty is stated per Tier; actual job time should be monitored as a quality check, not treated as a blocker to using the model.');
