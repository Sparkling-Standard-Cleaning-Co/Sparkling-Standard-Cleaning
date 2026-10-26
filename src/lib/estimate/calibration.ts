// Facility pricing calibration — hypothetical, research-based scenarios.
//
// These are NOT completed customer jobs. They exercise the SAME shared
// workload/price functions used by the website and server verifier, with a
// broad matrix of sizes, fixtures, conditions, floors, schedules and travel.
// Every row exposes its assumptions and uncertainty; complex scopes remain
// custom reviews instead of receiving an invented number.

import { pricing } from '../../config/pricing.ts';
import {
  calculateChurchEstimate,
  calculateFacilityPrice,
  calculateFacilityWorkload,
  type FacilityQuoteOptions,
  type FacilityType,
  type FacilityTraffic,
  type FlooringType,
} from './commercial.ts';
import type { Condition } from '../../config/pricing.ts';

export type CalibrationKind = 'commercial' | 'church';

export interface FacilityCalibrationScenario {
  id: string;
  name: string;
  kind: CalibrationKind;
  sqft: number;
  fixtures: number;
  breakroom: boolean;
  facilityType: FacilityType;
  condition: Condition;
  traffic: FacilityTraffic;
  flooring: FlooringType;
  firstClean: boolean;
  specialty: boolean;
  /** Per-visit schedule used for the customer estimate. */
  frequency: string;
  /** Multiplier for the monthly-equivalent calculation. */
  visitsPerWeek: number;
  oneWayMiles?: number;
  note?: string;
}

export interface FacilityCalibrationRow {
  id: string;
  name: string;
  kind: CalibrationKind;
  sqft: number;
  fixtures: number;
  frequency: string;
  visitsPerWeek: number;
  areaHours: number;
  setupHours: number;
  fixtureHours: number;
  breakroomHours: number;
  totalLaborHours: number;
  laborCost: number;
  cleaningSubtotal: number;
  discount: number;
  globalAdjustment: number;
  serviceRevenue: number | null;
  travelCharge: number;
  totalPerVisit: number;
  monthlyEquivalent: number | null;
  overhead: number | null;
  contributionAfterLabor: number | null;
  operatingProfit: number | null;
  effectivePerSqftPerVisit: number | null;
  customerEstimate: string;
  tier: 'A' | 'B' | 'C';
  uncertainty: string;
  specialty: boolean;
  reconciliation: string;
  note: string | null;
}

const OVERHEAD_RATE = pricing.commercialPricing.overheadRatePercent.value / 100;
const LABOR_RATE = pricing.laborEconomics.ownerLaborTargetPerHour.value;

function round2(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

function visitsPerMonth(scenario: FacilityCalibrationScenario): number | null {
  if (scenario.frequency === 'monthly') return 1;
  if (scenario.frequency === 'biweekly') return 2.17 * scenario.visitsPerWeek;
  if (scenario.frequency === 'weekly') return 4.33 * scenario.visitsPerWeek;
  if (scenario.frequency === 'daily') return 21.7 * scenario.visitsPerWeek;
  return null;
}

function uncertaintyFor(tier: 'A' | 'B' | 'C', specialty: boolean): string {
  if (specialty) return 'High — specialty scope requires a walkthrough; no numeric estimate.';
  if (tier === 'A') return 'Low — single preliminary estimate; final scope confirmation required.';
  if (tier === 'B') return 'Moderate — ±15% range; travel and condition need confirmation.';
  return 'High — workload exceeds the standard model; personal scope review required.';
}

export function runFacilityCalibration(
  scenario: FacilityCalibrationScenario,
  options: { globalFactor?: number } = {},
): FacilityCalibrationRow {
  const input = {
    cleanableSqft: scenario.sqft,
    restroomFixtures: scenario.fixtures,
    breakroom: scenario.breakroom,
    facilityType: scenario.facilityType,
    condition: scenario.condition,
    traffic: scenario.traffic,
    flooring: scenario.flooring,
    firstClean: scenario.firstClean,
    specialty: scenario.specialty,
  };
  const workload = calculateFacilityWorkload(input);
  const quoteOptions: FacilityQuoteOptions = {
    church: scenario.kind === 'church',
    numericEstimatesEnabled: true,
    globalFactorOverride: options.globalFactor ?? 1,
    ...(scenario.oneWayMiles ? { oneWayMiles: scenario.oneWayMiles } : {}),
  };
  const price =
    scenario.kind === 'church'
      ? calculateChurchEstimate({
          ...input,
          frequency: scenario.frequency,
          ...(scenario.oneWayMiles ? { oneWayMiles: scenario.oneWayMiles } : {}),
          globalFactorOverride: options.globalFactor ?? 1,
          numericEstimatesEnabled: true,
        }).price
      : calculateFacilityPrice(workload, scenario.frequency, quoteOptions);

  const priced = price.priced && !scenario.specialty && workload.tier !== 'C';
  const serviceRevenue = priced ? round2(price.total - price.travelAdjustment) : null;
  const laborCost = round2(workload.laborHours * LABOR_RATE);
  const overhead = serviceRevenue === null ? null : round2(serviceRevenue * OVERHEAD_RATE);
  const contributionAfterLabor = serviceRevenue === null ? null : round2(serviceRevenue - laborCost);
  const operatingProfit = serviceRevenue === null || overhead === null || contributionAfterLabor === null ? null : round2(contributionAfterLabor - overhead);
  const perMonth = priced ? visitsPerMonth(scenario) : null;
  const discount = price.discount?.applied ? price.discount.amount : 0;
  const discountExpected = scenario.kind === 'church' ? round2(price.cleaningSubtotal * 0.1) : 0;
  const reconciliation =
    scenario.kind === 'church'
      ? `subtotal ${price.cleaningSubtotal.toFixed(2)} − discount ${discount.toFixed(2)} = ${round2(price.cleaningSubtotal - discount).toFixed(2)}; total ${price.total.toFixed(2)}`
      : `cleaning ${price.perVisit.toFixed(2)} + travel ${price.travelAdjustment.toFixed(2)} = ${price.total.toFixed(2)}`;

  const customerEstimate = !priced
    ? 'Custom scope review'
    : price.range
      ? `$${price.range.low.toFixed(2)}–$${price.range.high.toFixed(2)} per visit`
      : `$${price.total.toFixed(2)} per visit`;

  return {
    id: scenario.id,
    name: scenario.name,
    kind: scenario.kind,
    sqft: scenario.sqft,
    fixtures: scenario.fixtures,
    frequency: scenario.frequency,
    visitsPerWeek: scenario.visitsPerWeek,
    areaHours: workload.areaHours,
    setupHours: workload.setupHours,
    fixtureHours: workload.fixtureHours,
    breakroomHours: workload.breakroomHours,
    totalLaborHours: workload.laborHours,
    laborCost,
    cleaningSubtotal: price.cleaningSubtotal,
    discount,
    globalAdjustment: price.globalAdjustment,
    serviceRevenue,
    travelCharge: price.travelAdjustment,
    totalPerVisit: price.total,
    monthlyEquivalent: perMonth ? round2(price.total * perMonth) : null,
    overhead,
    contributionAfterLabor,
    operatingProfit,
    effectivePerSqftPerVisit: priced && scenario.sqft > 0 ? round2(price.total / scenario.sqft) : null,
    customerEstimate,
    tier: workload.tier,
    uncertainty: uncertaintyFor(workload.tier, scenario.specialty),
    specialty: scenario.specialty,
    reconciliation: scenario.kind === 'church' && Math.abs(discount - discountExpected) > 0.005
      ? `${reconciliation}; ERROR discount expected ${discountExpected.toFixed(2)}`
      : reconciliation,
    note: scenario.note ?? null,
  };
}

export const COMMERCIAL_SCENARIOS: readonly FacilityCalibrationScenario[] = [
  { id: 'c01', name: 'Small office 800 sqft', kind: 'commercial', sqft: 800, fixtures: 2, breakroom: false, facilityType: 'office', condition: 'maintained', traffic: 'low', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c02', name: 'Small office 1,200 sqft', kind: 'commercial', sqft: 1200, fixtures: 4, breakroom: false, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c03', name: 'Small office 2,000 sqft', kind: 'commercial', sqft: 2000, fixtures: 6, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c04', name: 'Medium office 3,500 sqft', kind: 'commercial', sqft: 3500, fixtures: 8, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c05', name: 'Medium office 5,000 sqft high traffic', kind: 'commercial', sqft: 5000, fixtures: 10, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c06', name: 'Larger office 7,500 sqft', kind: 'commercial', sqft: 7500, fixtures: 14, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c07', name: 'Larger office 10,000 sqft', kind: 'commercial', sqft: 10000, fixtures: 16, breakroom: true, facilityType: 'office', condition: 'needs_attention', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c08', name: 'Retail store 2,500 sqft', kind: 'commercial', sqft: 2500, fixtures: 4, breakroom: false, facilityType: 'retail', condition: 'average', traffic: 'high', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c09', name: 'Retail store 6,000 sqft', kind: 'commercial', sqft: 6000, fixtures: 8, breakroom: true, facilityType: 'retail', condition: 'average', traffic: 'high', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c10', name: 'Salon 1,400 sqft', kind: 'commercial', sqft: 1400, fixtures: 4, breakroom: false, facilityType: 'salon', condition: 'average', traffic: 'high', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c11', name: 'Salon 2,200 sqft overdue', kind: 'commercial', sqft: 2200, fixtures: 6, breakroom: false, facilityType: 'salon', condition: 'needs_attention', traffic: 'high', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c12', name: 'Gym 4,000 sqft', kind: 'commercial', sqft: 4000, fixtures: 8, breakroom: true, facilityType: 'gym', condition: 'average', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c13', name: 'Gym 7,000 sqft heavy use', kind: 'commercial', sqft: 7000, fixtures: 12, breakroom: true, facilityType: 'gym', condition: 'needs_attention', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 2 },
  { id: 'c14', name: 'Professional office 3,000 sqft', kind: 'commercial', sqft: 3000, fixtures: 6, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 2 },
  { id: 'c15', name: 'Professional suite 5,000 sqft 2x/week', kind: 'commercial', sqft: 5000, fixtures: 10, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 2 },
  { id: 'c16', name: 'Community facility 6,000 sqft', kind: 'commercial', sqft: 6000, fixtures: 12, breakroom: true, facilityType: 'community', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c17', name: 'High-restroom office 2,000 sqft / 18 fixtures', kind: 'commercial', sqft: 2000, fixtures: 18, breakroom: false, facilityType: 'office', condition: 'average', traffic: 'high', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c18', name: 'High-restroom facility 4,000 sqft / 24 fixtures', kind: 'commercial', sqft: 4000, fixtures: 24, breakroom: true, facilityType: 'community', condition: 'average', traffic: 'high', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c19', name: 'High-traffic office 3,000 sqft 3x/week', kind: 'commercial', sqft: 3000, fixtures: 8, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 3 },
  { id: 'c20', name: 'Heavy-condition office 2,500 sqft', kind: 'commercial', sqft: 2500, fixtures: 6, breakroom: true, facilityType: 'office', condition: 'heavy', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c21', name: 'Initial clean office 4,000 sqft', kind: 'commercial', sqft: 4000, fixtures: 8, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: true, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c22', name: 'Monthly office 5,000 sqft', kind: 'commercial', sqft: 5000, fixtures: 8, breakroom: true, facilityType: 'office', condition: 'maintained', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'monthly', visitsPerWeek: 1 },
  { id: 'c23', name: 'Carpeted office 3,500 sqft', kind: 'commercial', sqft: 3500, fixtures: 8, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'carpet', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c24', name: 'Hard-floor office 3,500 sqft', kind: 'commercial', sqft: 3500, fixtures: 8, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'c25', name: 'Extended-travel office 3,000 sqft', kind: 'commercial', sqft: 3000, fixtures: 8, breakroom: true, facilityType: 'office', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1, oneWayMiles: 40, note: 'Beyond the 17.5 included one-way miles.' },
  { id: 'c26', name: 'Post-construction office 2,500 sqft', kind: 'commercial', sqft: 2500, fixtures: 6, breakroom: true, facilityType: 'office', condition: 'heavy', traffic: 'high', flooring: 'mixed', firstClean: true, specialty: true, frequency: 'weekly', visitsPerWeek: 1, note: 'Specialty scope — custom review required.' },
];

export const CHURCH_SCENARIOS: readonly FacilityCalibrationScenario[] = [
  { id: 'h01', name: 'Small church 1,500 sqft', kind: 'church', sqft: 1500, fixtures: 4, breakroom: false, facilityType: 'church', condition: 'maintained', traffic: 'low', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h02', name: 'Small church 2,200 sqft', kind: 'church', sqft: 2200, fixtures: 6, breakroom: false, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h03', name: 'Small church 3,000 sqft with kitchen', kind: 'church', sqft: 3000, fixtures: 6, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h04', name: 'Medium church 4,000 sqft', kind: 'church', sqft: 4000, fixtures: 8, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h05', name: 'Medium church 6,000 sqft high traffic', kind: 'church', sqft: 6000, fixtures: 10, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h06', name: 'Medium church 8,000 sqft', kind: 'church', sqft: 8000, fixtures: 12, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h07', name: 'Active church 9,000 sqft 2x/week', kind: 'church', sqft: 9000, fixtures: 14, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 2 },
  { id: 'h08', name: 'Larger church 12,000 sqft overdue', kind: 'church', sqft: 12000, fixtures: 16, breakroom: true, facilityType: 'church', condition: 'needs_attention', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h09', name: 'Large church campus 18,000 sqft', kind: 'church', sqft: 18000, fixtures: 24, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h10', name: 'Monthly church 5,000 sqft', kind: 'church', sqft: 5000, fixtures: 8, breakroom: true, facilityType: 'church', condition: 'maintained', traffic: 'low', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'monthly', visitsPerWeek: 1 },
  { id: 'h11', name: 'Heavy-use church 7,000 sqft', kind: 'church', sqft: 7000, fixtures: 10, breakroom: true, facilityType: 'church', condition: 'heavy', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h12', name: 'Initial deep clean church 3,200 sqft', kind: 'church', sqft: 3200, fixtures: 6, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: true, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h13', name: 'Carpeted sanctuary 4,500 sqft', kind: 'church', sqft: 4500, fixtures: 8, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'carpet', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h14', name: 'Hard-floor fellowship hall 4,500 sqft', kind: 'church', sqft: 4500, fixtures: 8, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'hard', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h15', name: 'Church with nursery 6,000 sqft 2x/week', kind: 'church', sqft: 6000, fixtures: 12, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 2 },
  { id: 'h16', name: 'Church classrooms 10,000 sqft', kind: 'church', sqft: 10000, fixtures: 18, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h17', name: 'Small church 2,500 sqft', kind: 'church', sqft: 2500, fixtures: 4, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'low', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h18', name: 'Large church 15,000 sqft', kind: 'church', sqft: 15000, fixtures: 20, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h19', name: 'Complex church 11,000 sqft / 22 fixtures', kind: 'church', sqft: 11000, fixtures: 22, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'high', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1 },
  { id: 'h20', name: 'Extended-travel church 4,000 sqft', kind: 'church', sqft: 4000, fixtures: 8, breakroom: true, facilityType: 'church', condition: 'average', traffic: 'average', flooring: 'mixed', firstClean: false, specialty: false, frequency: 'weekly', visitsPerWeek: 1, oneWayMiles: 45, note: 'Travel beyond included miles; confirmed separately.' },
];

export function runAllCalibration(globalFactor = 1): {
  commercial: FacilityCalibrationRow[];
  church: FacilityCalibrationRow[];
} {
  return {
    commercial: COMMERCIAL_SCENARIOS.map((scenario) => runFacilityCalibration(scenario, { globalFactor })),
    church: CHURCH_SCENARIOS.map((scenario) => runFacilityCalibration(scenario, { globalFactor })),
  };
}
