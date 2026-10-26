// Initiative 6.2 scenario matrix — representative, hypothetical estimates.
// The browser estimator returns the SAME shared calculation the server
// re-runs; this script prints the inputs and resulting economics for review.
import { calculateEstimate } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import {
  calculateChurchEstimate,
  calculateFacilityPrice,
  calculateFacilityWorkload,
} from '../src/lib/estimate/commercial.ts';
import { taxPresentationForService } from '../src/lib/estimate/tax.ts';
import { pricing } from '../src/config/pricing.ts';

const travel = {
  includedOneWayMiles: 15,
  mpg: 24,
  wearPerMile: 0.12,
  referenceGasPrice: 3.1,
  zoneAdjustments: { core: 0, surrounding: 15 },
  maxInstantDistanceMiles: 45,
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

const rows = [];
const addResidential = (name, input, factor = 1, promotions = undefined) => {
  const result = calculateEstimate(input, { travel, globalFactorOverride: factor, ...(promotions ? { promotions } : {}) });
  const tax = taxPresentationForService(input.serviceType);
  rows.push({
    scenario: name,
    engine: input.serviceType === 'str_turnover' ? 'STR' : 'Residential',
    factor: factor.toFixed(2),
    hours: result.laborHours,
    base: result.pricing.basePrice + result.pricing.extrasSubtotal + result.pricing.roundingAdjustment,
    discount: result.pricing.discount?.amount ?? 0,
    global: result.pricing.globalAdjustment,
    travel: result.pricing.travelAdjustment,
    tax: tax.label,
    final: selectInstantAmount(result),
    tier: '-',
  });
};

for (const factor of [0.9, 1.0, 1.1]) {
  addResidential('One-time standard 1,600 sqft 3/2', residentialInput(), factor);
  addResidential('Deep clean 1,600 sqft 3/2', residentialInput({ serviceType: 'deep' }), factor);
}
addResidential('Community Support eligible — one-time standard', residentialInput({ supportiveEligible: true }));
addResidential('SPARKLE100 claimed — weekly arrangement (first visit)', residentialInput({ frequency: 'weekly' }), 1, { claimedCampaignCode: 'SPARKLE100' });
addResidential('STR turnover 2/1, 4 beds', residentialInput({ serviceType: 'str_turnover', propertyType: 'condo', squareFeet: 900, bedrooms: 2, fullBaths: 1, beds: 4 }));

const facility = (name, kind, input, factor = 1) => {
  const workload = calculateFacilityWorkload(input);
  const price = kind === 'church'
    ? calculateChurchEstimate({ ...input, globalFactorOverride: factor }).price
    : calculateFacilityPrice(workload, 'weekly', { globalFactorOverride: factor });
  const tax = taxPresentationForService(kind === 'church' ? 'church_cleaning' : 'commercial_cleaning');
  rows.push({
    scenario: name,
    engine: kind === 'church' ? 'Church' : 'Commercial',
    factor: factor.toFixed(2),
    hours: workload.laborHours,
    base: price.cleaningSubtotal,
    discount: price.discount?.amount ?? 0,
    global: price.globalAdjustment,
    travel: price.travelAdjustment,
    tax: tax.label,
    final: price.priced ? price.total : 'Custom review',
    tier: workload.tier,
  });
};

for (const factor of [0.9, 1.0, 1.1]) {
  facility('Tier A office 2,000 sqft', 'commercial', { cleanableSqft: 2000, restroomFixtures: 6, breakroom: false, facilityType: 'office' }, factor);
  facility('Tier B office 6,000 sqft', 'commercial', { cleanableSqft: 6000, restroomFixtures: 10, breakroom: true, facilityType: 'office' }, factor);
}
facility('Tier C 30,000 sqft / 24 fixtures', 'commercial', { cleanableSqft: 30000, restroomFixtures: 24, breakroom: true, facilityType: 'office' }, 1);
facility('Church 4,000 sqft / 6 fixtures', 'church', { cleanableSqft: 4000, restroomFixtures: 6, breakroom: false, facilityType: 'church' }, 1);
facility('Church 8,000 sqft / 12 fixtures', 'church', { cleanableSqft: 8000, restroomFixtures: 12, breakroom: true, facilityType: 'church' }, 1);
facility('Church 18,000 sqft / 24 fixtures', 'church', { cleanableSqft: 18000, restroomFixtures: 24, breakroom: true, facilityType: 'church' }, 1);

console.log(`Facility rate: $${pricing.commercialPricing.grossRatePerHour.value}/labor-hour; minimum $${pricing.minimumJob.value}; commercial calibration ${pricing.estimatorCalibration.commercial.value.toFixed(2)}`);
console.table(rows.map((row) => ({
  Scenario: row.scenario,
  Engine: row.engine,
  Factor: row.factor,
  'Labor hrs': row.hours,
  'Base cleaning': Number(row.base).toFixed(2),
  Discount: Number(row.discount).toFixed(2),
  'Calibration': Number(row.global).toFixed(2),
  Travel: Number(row.travel).toFixed(2),
  Tax: row.tax,
  Final: typeof row.final === 'number' ? Number(row.final).toFixed(2) : row.final,
  Tier: row.tier,
})));