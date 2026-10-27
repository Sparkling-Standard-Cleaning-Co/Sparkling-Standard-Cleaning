// Owner pricing impact preview.
//
// Prints representative residential, STR, commercial and church estimates
// from the real calculators. With `--compare <git-ref>` it checks out that
// historical tree into a temporary directory, runs this same report there, and
// shows a before/after comparison. No customer jobs, market data or completed
// costs are invented.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pricing, pricingValue } from '../src/config/pricing.ts';
import { calculateEstimate } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import {
  calculateFacilityPrice,
  calculateFacilityWorkload,
} from '../src/lib/estimate/commercial.ts';
import { taxPresentationForService } from '../src/lib/estimate/tax.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const compareArg = args.indexOf('--compare');
const compareRef = compareArg >= 0 ? args[compareArg + 1] : null;

const money = (value) =>
  value === null || value === undefined
    ? '—'
    : `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const context = {
  travel: {
    includedOneWayMiles: pricingValue(pricing.travel.includedOneWayMiles),
    mpg: pricingValue(pricing.travel.clientDefaults.mpg),
    wearPerMile: pricingValue(pricing.travel.perMileWearCost),
    referenceGasPrice: pricingValue(pricing.travel.fallbackGasPrice),
    zoneAdjustments: {
      core: 0,
      surrounding: pricingValue(pricing.travel.zoneAdjustments.surrounding),
    },
    maxInstantDistanceMiles: pricingValue(pricing.travel.clientDefaults.maxInstantDistanceMiles),
    maxDrivingMinutes: pricingValue(pricing.drivingPolicy.maxDrivingMinutes),
    reviewBandMinutes: pricingValue(pricing.drivingPolicy.reviewBandMinutes),
  },
};

const residentialInput = (overrides = {}) => ({
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
});

function residentialRow(id, label, input) {
  const result = calculateEstimate(input, context);
  const pricingRow = result.pricing;
  return {
    id,
    label,
    engine: input.serviceType === 'str_turnover' ? 'str' : 'residential',
    laborHours: result.laborHours,
    serviceSubtotal: Math.max(0, pricingRow.basePrice + pricingRow.extrasSubtotal + pricingRow.roundingAdjustment),
    discount: pricingRow.discount?.amount ?? 0,
    calibrationFactor: pricingRow.globalFactor,
    calibrationAdjustment: pricingRow.globalAdjustment,
    travelAdjustment: pricingRow.travelAdjustment,
    total: selectInstantAmount(result) ?? result.expectedPrice,
    tax: taxPresentationForService(input.serviceType).label,
    warnings: result.flags.map((flag) => flag.code),
  };
}

function ongoingRow(id, label, result) {
  if (!result.ongoing) return null;
  const p = result.ongoing.pricing;
  return {
    id,
    label,
    engine: 'residential',
    laborHours: result.ongoing.laborHours,
    serviceSubtotal: Math.max(0, p.basePrice + p.extrasSubtotal + p.roundingAdjustment),
    discount: p.discount?.amount ?? 0,
    calibrationFactor: p.globalFactor,
    calibrationAdjustment: p.globalAdjustment,
    travelAdjustment: p.travelAdjustment,
    total: result.ongoing.perVisitPrice,
    tax: taxPresentationForService('standard').label,
    warnings: ['ONGOING_PER_VISIT'],
  };
}

function facilityRow(id, label, engine, input, frequency = 'weekly') {
  const church = engine === 'church';
  const workload = calculateFacilityWorkload(input);
  const price = calculateFacilityPrice(workload, frequency, { church });
  return {
    id,
    label,
    engine,
    laborHours: workload.laborHours,
    serviceSubtotal: price.cleaningSubtotal,
    discount: price.discount?.amount ?? 0,
    calibrationFactor: price.globalFactor,
    calibrationAdjustment: price.globalAdjustment,
    travelAdjustment: price.travelAdjustment,
    total: price.priced ? price.total : null,
    tax: taxPresentationForService(church ? 'church_cleaning' : 'commercial_cleaning').label,
    warnings: price.priced ? (price.tier === 'C' ? ['CUSTOM_SCOPE_REVIEW'] : []) : ['CUSTOM_SCOPE_REVIEW'],
  };
}

function buildReport() {
  const scenarios = [];
  scenarios.push(residentialRow('res-small-maintenance', 'Small residential maintenance clean', residentialInput({ squareFeet: 700, bedrooms: 1, fullBaths: 1 })));
  scenarios.push(residentialRow('res-typical-3-2', 'Typical 3-bed / 2-bath residential clean', residentialInput()));
  scenarios.push(residentialRow('res-typical-3-2-oven', 'Typical 3-bed / 2-bath + inside oven', residentialInput({ addonIds: ['inside_oven'] })));
  scenarios.push(residentialRow('res-deep-3-2', 'Typical 3-bed / 2-bath deep clean', residentialInput({ serviceType: 'deep' })));
  scenarios.push(residentialRow('res-kitchen-bundle', 'Typical 3-bed / 2-bath + Kitchen Refresh Bundle', residentialInput({ addonIds: ['inside_fridge', 'inside_oven', 'inside_cabinets'] })));
  scenarios.push(residentialRow('res-deep-detail-bundle', 'Typical deep clean + Deep Detail Bundle', residentialInput({ serviceType: 'deep', addonIds: ['detailed_baseboards', 'detailed_walls', 'interior_windows'] })));
  const recurring = calculateEstimate(residentialInput({ frequency: 'biweekly' }), context);
  scenarios.push(residentialRow('res-recurring-first-visit', 'New biweekly recurring arrangement — first visit', residentialInput({ frequency: 'biweekly' })));
  const ongoing = ongoingRow('res-recurring-ongoing', 'New biweekly recurring arrangement — ongoing visit', recurring);
  if (ongoing) scenarios.push(ongoing);
  scenarios.push(residentialRow('res-community-support', 'Community Support eligible residential clean', residentialInput({ supportiveEligible: true })));
  scenarios.push(residentialRow('res-minimum', 'Minimum-charge residential case', residentialInput({ propertyType: 'apartment', squareFeet: 200, bedrooms: 0, fullBaths: 0 })));
  scenarios.push(residentialRow('str-typical', 'Typical STR turnover', residentialInput({ serviceType: 'str_turnover', propertyType: 'condo', squareFeet: 900, bedrooms: 2, fullBaths: 2, beds: 2 })));
  scenarios.push(residentialRow('str-medium', 'Medium STR turnover', residentialInput({ serviceType: 'str_turnover', propertyType: 'house', squareFeet: 2200, bedrooms: 4, fullBaths: 3, beds: 5 })));

  scenarios.push(facilityRow('commercial-small-office', 'Small commercial office', 'commercial', { cleanableSqft: 2000, restroomFixtures: 6, breakroom: true, facilityType: 'office' }));
  scenarios.push(facilityRow('commercial-medium-office', 'Medium commercial office', 'commercial', { cleanableSqft: 6000, restroomFixtures: 10, breakroom: true, facilityType: 'office' }));
  scenarios.push(facilityRow('church-small', 'Small church', 'church', { cleanableSqft: 4000, restroomFixtures: 6, breakroom: true, facilityType: 'church' }));
  scenarios.push(facilityRow('church-medium', 'Medium church', 'church', { cleanableSqft: 8000, restroomFixtures: 12, breakroom: true, facilityType: 'church' }));

  return {
    configVersion: pricing.instantQuote.configVersion.value,
    factors: {
      residential: pricingValue(pricing.estimatorCalibration.residential),
      str: pricingValue(pricing.estimatorCalibration.str),
      commercial: pricingValue(pricing.estimatorCalibration.commercial),
      church: pricingValue(pricing.estimatorCalibration.church),
    },
    scenarios,
  };
}

function runBaseline(ref) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sparkling-pricing-impact-'));
  const archive = path.join(temp, 'baseline.tar');
  const tree = path.join(temp, 'tree');
  fs.mkdirSync(tree, { recursive: true });
  try {
    const tar = execFileSync('git', ['archive', '--format=tar', ref], {
      cwd: ROOT,
      maxBuffer: 80 * 1024 * 1024,
    });
    fs.writeFileSync(archive, tar);
    execFileSync('tar', ['-xf', archive, '-C', tree], { maxBuffer: 20 * 1024 * 1024 });
    fs.copyFileSync(SCRIPT, path.join(tree, 'scripts', 'pricing-impact.mjs'));
    const output = spawnSync(process.execPath, ['--experimental-strip-types', path.join(tree, 'scripts', 'pricing-impact.mjs'), '--json'], {
      cwd: tree,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    if (output.status !== 0) {
      throw new Error(output.stderr || output.stdout || `baseline report failed for ${ref}`);
    }
    return JSON.parse(output.stdout);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function printComparison(before, after) {
  console.log(`Pricing impact: ${before.configVersion} -> ${after.configVersion}`);
  console.log('\nCalibration factors:');
  for (const engine of ['residential', 'str', 'commercial', 'church']) {
    const old = before.factors[engine];
    const next = after.factors[engine];
    console.log(`  ${engine.padEnd(12)} ${old.toFixed(2)} -> ${next.toFixed(2)}${old === next ? '' : '  CHANGED'}`);
  }
  console.log('\nRepresentative estimates:');
  console.log('Scenario'.padEnd(45), 'Engine'.padEnd(12), 'Before'.padStart(12), 'After'.padStart(12), 'Difference'.padStart(14));
  for (const next of after.scenarios) {
    const old = before.scenarios.find((scenario) => scenario.id === next.id);
    const oldTotal = old?.total ?? null;
    const newTotal = next.total ?? null;
    const difference = oldTotal !== null && newTotal !== null ? newTotal - oldTotal : null;
    const diffText = difference === null ? '—' : `${difference >= 0 ? '+' : ''}${money(difference)}`;
    console.log(
      next.label.padEnd(45),
      next.engine.padEnd(12),
      money(oldTotal).padStart(12),
      money(newTotal).padStart(12),
      diffText.padStart(14),
    );
  }
}

function printReport(report) {
  console.log(`Automatic pricing version: ${report.configVersion}`);
  console.log(
    `Calibration: residential ${report.factors.residential.toFixed(2)}; STR ${report.factors.str.toFixed(2)}; commercial ${report.factors.commercial.toFixed(2)}; church ${report.factors.church.toFixed(2)}`,
  );
  console.table(
    report.scenarios.map((scenario) => ({
      Scenario: scenario.label,
      Engine: scenario.engine,
      'Labor hrs': scenario.laborHours?.toFixed(2) ?? '—',
      'Service subtotal': money(scenario.serviceSubtotal),
      Discount: money(scenario.discount),
      'Calibration': scenario.calibrationFactor.toFixed(2),
      'Cal. adj.': money(scenario.calibrationAdjustment),
      Travel: money(scenario.travelAdjustment),
      Tax: scenario.tax,
      Final: money(scenario.total),
      Warnings: scenario.warnings.join(', '),
    })),
  );
  console.log('\nThese are model outputs, not completed jobs or market quotes. Tax is disclosed per category.');
}

const after = buildReport();
if (compareRef) {
  const before = runBaseline(compareRef);
  if (jsonMode) {
    console.log(JSON.stringify({ before, after }, null, 2));
  } else {
    printComparison(before, after);
  }
} else if (jsonMode) {
  console.log(JSON.stringify(after, null, 2));
} else {
  printReport(after);
}
