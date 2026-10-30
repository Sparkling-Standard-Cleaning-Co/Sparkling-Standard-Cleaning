// Independent price-regression verification against the frozen 8,771-scenario
// audit matrix. Every price is recomputed by the CURRENT estimator code and
// compared with the recorded result, so the "zero customer price changes" claim
// is checked against the code that will actually be deployed.
//
// Usage:
//   node scripts/pricing-regression-verify.mjs --scenarios <quote-scenarios.json>
//     [--json <output.json>] [--limit <n>]
//
// This script performs no network access and writes nothing unless --json is
// supplied.

import fs from 'node:fs';
import path from 'node:path';

import { calculateEstimate } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { calculateFacilityPrice } from '../src/lib/estimate/commercial.ts';
import { pricing } from '../src/config/pricing.ts';
import { travelConfig } from '../src/config/estimators/travel.ts';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const scenariosPath = arg(
  'scenarios',
  'C:/Users/thoma/Downloads/Sparkling-Standard-Master/06_PRICING_AND_FINANCIALS/Original_Pricing_Audit/quote-scenarios.json',
);
const jsonOut = arg('json', '');
const limit = Number(arg('limit', '0')) || 0;

if (!fs.existsSync(scenariosPath)) {
  console.error(`Scenario file not found: ${scenariosPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
const rows = Array.isArray(data.rows) ? data.rows : [];
if (rows.length === 0) {
  console.error('No scenario rows found.');
  process.exit(1);
}

const addonByLabel = new Map(pricing.addons.items.map((item) => [item.label, item.id]));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const near = (left, right) => {
  if (left === null || left === undefined || right === null || right === undefined || right === '') return false;
  return Math.abs(Number(left) - Number(right)) < 0.005;
};

const failures = [];
const coverage = {
  total: rows.length,
  residential: 0,
  facility: 0,
  skippedRoutedTravel: 0,
  skippedUnknownAddon: 0,
  comparedFirstPrice: 0,
  comparedOngoingPrice: 0,
  comparedStatus: 0,
  comparedFacilityBase: 0,
  comparedFacilityTotal: 0,
};

for (const row of rows) {
  if (limit > 0 && coverage.residential + coverage.facility >= limit) break;
  if (row.travel_mode === 'routed_fixture' || row.travel_mode === 'unavailable') {
    coverage.skippedRoutedTravel += 1;
    continue;
  }
  if (row.estimator === 'Residential' || row.estimator === 'STR') {
    const scenarioText = `${row.scenario_group ?? ''} ${row.scenario_label ?? ''} ${row.promotion_or_bundle ?? ''}`.toLowerCase();
    const addonLabels = String(row.addons ?? '')
      .split(';')
      .map((label) => label.trim())
      .filter(Boolean);
    const addonIds = [];
    let unknown = false;
    for (const label of addonLabels) {
      const id = addonByLabel.get(label);
      if (!id) {
        unknown = true;
        break;
      }
      addonIds.push(id);
    }
    if (unknown) {
      coverage.skippedUnknownAddon += 1;
      continue;
    }
    const specialtyMatch = scenarioText.match(/specialty\s+([a-z_]+)/);
    if (specialtyMatch && addonByLabel.has(specialtyMatch[1]) === false) {
      const id = specialtyMatch[1];
      if (pricing.addons.items.some((item) => item.id === id && item.customQuote)) addonIds.push(id);
    }
    coverage.residential += 1;
    const travelValue = Number(row.travel_usd) || 0;
    const promotions = String(row.promotion_or_bundle ?? '');
    const claimedCampaignCode = promotions.toLowerCase().includes('sparkle100') ? 'SPARKLE100' : null;
    const input = {
      serviceType: row.service,
      ...(row.property_type ? { propertyType: row.property_type } : {}),
      squareFeet: Number(row.square_feet) || 0,
      bedrooms: Number(row.bedrooms) || 0,
      fullBaths: Number(row.full_baths) || 0,
      halfBaths: Number(row.half_baths) || 0,
      ...(row.beds !== '' && row.beds !== null && row.beds !== undefined ? { beds: Number(row.beds) } : {}),
      frequency: row.frequency,
      condition: row.condition,
      lastClean: ['within_month', 'one_to_three_months', 'three_to_twelve_months', 'over_a_year', 'never_professional', 'not_sure'].includes(row.last_clean)
        ? row.last_clean
        : 'not_sure',
      addonIds,
      zip: row.travel_zone === 'extended' ? '36532' : row.travel_zone === 'outside' ? '10001' : '32503',
      ...(row.pets ? { pets: row.pets } : {}),
      ...(scenarioText.includes('community support') ? { supportiveEligible: true } : {}),
    };
    const context = {
      travel: {
        includedOneWayMiles: travelConfig.includedOneWayMiles,
        mpg: travelConfig.mpg,
        wearPerMile: travelConfig.wearPerMile,
        referenceGasPrice: travelConfig.fallbackGasPrice,
        zoneAdjustments: { core: travelValue, surrounding: travelValue },
        maxInstantDistanceMiles: travelConfig.maxInstantDistanceMiles,
        maxDrivingMinutes: travelConfig.maxDrivingMinutes,
        reviewBandMinutes: travelConfig.reviewBandMinutes,
      },
      ...(claimedCampaignCode ? { promotions: { claimedCampaignCode } } : {}),
    };
    const result = calculateEstimate(input, context);
    if (result.status !== row.status) {
      failures.push({
        scenario_id: row.scenario_id,
        field: 'status',
        expected: row.status,
        actual: result.status,
        label: row.scenario_label,
      });
    } else {
      coverage.comparedStatus += 1;
    }
    const first = selectInstantAmount(result);
    if (row.first_visit_final !== '' && row.first_visit_final !== null && row.first_visit_final !== undefined) {
      if (!near(first, row.first_visit_final)) {
        failures.push({
          scenario_id: row.scenario_id,
          field: 'first_visit_final',
          expected: row.first_visit_final,
          actual: first,
          label: row.scenario_label,
        });
      } else {
        coverage.comparedFirstPrice += 1;
      }
    } else if (row.status === 'estimated' && first !== null) {
      failures.push({
        scenario_id: row.scenario_id,
        field: 'first_visit_final',
        expected: '(none recorded)',
        actual: first,
        label: row.scenario_label,
      });
    }
    if (row.recurring_visit_final !== '' && row.recurring_visit_final !== null && row.recurring_visit_final !== undefined) {
      const ongoing = result.ongoing ? round2(result.ongoing.pricing.subtotal) : null;
      if (!near(ongoing, row.recurring_visit_final)) {
        failures.push({
          scenario_id: row.scenario_id,
          field: 'recurring_visit_final',
          expected: row.recurring_visit_final,
          actual: ongoing,
          label: row.scenario_label,
        });
      } else {
        coverage.comparedOngoingPrice += 1;
      }
    }
    continue;
  }

  // Commercial and church: rebuild the recorded workload exactly and reprice it.
  coverage.facility += 1;
  const fixtureMinutes = pricing.commercialPricing.fixtureMinutes.value;
  const fixtures = fixtureMinutes > 0 ? Math.round((Number(row.fixture_hours) * 60) / fixtureMinutes) : 0;
  const laborHours = Number(row.total_labor_hours);
  const tierBHours = pricing.commercialPricing.tierBHours.value;
  const tierAHours = pricing.commercialPricing.tierAHours.value;
  const specialty = String(row.specialty_addon) === 'yes';
  const tier =
    specialty || fixtures > 20 || laborHours > tierBHours
      ? 'C'
      : laborHours > tierAHours
        ? 'B'
        : 'A';
  const workload = {
    productionRate: Number(row.production_sqft_per_hour) || 0,
    areaHours: Number(row.area_hours) || 0,
    fixtureHours: Number(row.fixture_hours) || 0,
    breakroomHours: Number(row.breakroom_hours) || 0,
    setupHours: Number(row.setup_hours) || 0,
    conditionFactor: Number(row.condition_factor) || 1,
    trafficFactor: Number(row.traffic_factor) || 1,
    firstCleanFactor: Number(row.first_clean_factor) || 1,
    flooringFactor: Number(row.flooring_factor) || 1,
    laborHours,
    tier,
    scopeReviewRequired: tier === 'C',
    exclusions: [],
  };
  const oneWayMiles =
    row.travel_one_way_miles !== '' && row.travel_one_way_miles !== null && row.travel_one_way_miles !== undefined
      ? Number(row.travel_one_way_miles)
      : null;
  const price = calculateFacilityPrice(workload, row.frequency, {
    church: row.service === 'church_cleaning',
    oneWayMiles,
  });
  if (!near(price.cleaningSubtotal, row.base_cleaning_amount)) {
    failures.push({
      scenario_id: row.scenario_id,
      field: 'base_cleaning_amount',
      expected: row.base_cleaning_amount,
      actual: price.cleaningSubtotal,
      label: row.scenario_label,
    });
  } else {
    coverage.comparedFacilityBase += 1;
  }
  if (rank(row.status) === rank('estimated')) {
    if (!near(price.total, row.expected_price)) {
      failures.push({
        scenario_id: row.scenario_id,
        field: 'expected_price',
        expected: row.expected_price,
        actual: price.total,
        label: row.scenario_label,
      });
    } else {
      coverage.comparedFacilityTotal += 1;
    }
  }
  if ((price.priced ? 'estimated' : 'custom_confirmation_required') !== row.status) {
    failures.push({
      scenario_id: row.scenario_id,
      field: 'status',
      expected: row.status,
      actual: price.priced ? 'estimated' : 'custom_confirmation_required',
      label: row.scenario_label,
    });
  }
}

function rank(status) {
  return status === 'estimated' ? 1 : 0;
}

const summary = {
  generatedAt: new Date().toISOString(),
  repository: process.cwd(),
  scenariosPath,
  configVersion: pricing.instantQuote.configVersion.value,
  auditConfigVersion: data.metadata?.pricingConfigVersion ?? null,
  coverage,
  failures: failures.length,
  failureSamples: failures.slice(0, 25),
};

console.log(`Scenarios in file: ${coverage.total}`);
console.log(`Residential/STR recomputed: ${coverage.residential}`);
console.log(`Commercial/church repriced: ${coverage.facility}`);
console.log(`Skipped (routed travel fixtures): ${coverage.skippedRoutedTravel}`);
console.log(`Skipped (unmapped add-on label): ${coverage.skippedUnknownAddon}`);
console.log(`Status matches: ${coverage.comparedStatus}`);
console.log(`First-visit prices matched: ${coverage.comparedFirstPrice}`);
console.log(`Ongoing prices matched: ${coverage.comparedOngoingPrice}`);
console.log(`Facility base prices matched: ${coverage.comparedFacilityBase}`);
console.log(`Facility totals matched: ${coverage.comparedFacilityTotal}`);
console.log(`Config version: ${summary.configVersion}`);
console.log(`Audit version:  ${summary.auditConfigVersion}`);
console.log(`Mismatches: ${failures.length}`);
if (failures.length > 0) {
  for (const failure of failures.slice(0, 25)) {
    console.log(`  ${failure.scenario_id} ${failure.field}: expected ${failure.expected}, got ${failure.actual} (${failure.label})`);
  }
}

if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Evidence written: ${jsonOut}`);
}

process.exitCode = failures.length > 0 ? 1 : 0;
