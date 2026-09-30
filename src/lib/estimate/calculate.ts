// Estimate orchestrator — turns raw input + travel context into the customer
// estimate range, review flags, confidence and an internal calculation trace.
//
// Fail-safe rules:
//  - invalid input returns status 'invalid' with no numbers;
//  - thresholds / severe condition / custom add-ons / out-of-range travel
//    return 'custom_confirmation_required' instead of fake precision;
//  - the minimum job value is applied silently to every estimate;
//  - prices are never negative or nonsensical.

import { pricing } from '../../config/pricing.ts';
import { zoneForZip } from '../../config/geography.ts';
import { calculateTravelAdjustment } from '../travel/calculateTravelAdjustment.ts';
import { selectAddons } from './addons.ts';
import { computeLaborHours } from './labor.ts';
import { recurringResetSuggested } from './frequency.ts';
import { validateEstimateInput } from './validation.ts';
import type {
  CalculationTraceEntry,
  EstimateFlag,
  EstimateInputDraft,
  EstimateResult,
  RoutedTravelInfo,
  TravelEstimate,
} from './types.ts';

export interface EstimateContext {
  travel: {
    /** Present only when the serverless routing function answered. */
    routed?: RoutedTravelInfo;
    includedOneWayMiles: number;
    /** Vehicle efficiency used by the server-side route calculation. */
    mpg: number;
    wearPerMile: number;
    referenceGasPrice: number;
    zoneAdjustments: { core: number; surrounding: number };
    maxInstantDistanceMiles: number;
  };
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

const EMPTY_TRAVEL: TravelEstimate = {
  mode: 'unavailable',
  zone: 'unknown',
  oneWayMiles: null,
  roundTripMiles: null,
  gasPricePerGallon: null,
  gasPriceSource: 'none',
  adjustment: 0,
  requiresManualConfirmation: true,
};

export function calculateEstimate(
  raw: EstimateInputDraft | null | undefined,
  context: EstimateContext,
): EstimateResult {
  const validation = validateEstimateInput(raw);
  if (!validation.ok) {
    return {
      status: 'invalid',
      low: null,
      high: null,
      laborHours: null,
      expectedPrice: null,
      confidence: 'low',
      flags: [],
      travel: EMPTY_TRAVEL,
      addons: [],
      minimumApplied: false,
      trace: [],
      issues: validation.issues,
      message: 'We need a little more information to estimate this clean.',
    };
  }

  const input = validation.input;
  const travelZone = zoneForZip(input.zip);
  const travel = calculateTravelAdjustment({ ...context.travel, zone: travelZone });
  const addonSelection = selectAddons(input.addonIds);
  const labor = computeLaborHours(input, addonSelection.totalLaborHours);
  const trace: CalculationTraceEntry[] = [...labor.trace];
  const flags: EstimateFlag[] = [];

  // ── Custom-confirmation gates (directive §27) ──────────────────────────────
  const thresholds = pricing.customQuoteThresholds;
  let customRequired = false;
  let customReason = '';

  if (input.condition === 'severe') {
    customRequired = true;
    customReason = 'A home in severe condition needs an in-person look before we can quote it fairly.';
  }
  if (!customRequired && input.squareFeet > thresholds.squareFeetOver.value) {
    customRequired = true;
    customReason = `Homes over ${thresholds.squareFeetOver.value.toLocaleString()} sqft are quoted with a walkthrough (or a few photos) so the scope is right.`;
  }
  if (!customRequired && input.fullBaths > thresholds.fullBathsOver.value) {
    customRequired = true;
    customReason = 'A home with this many bathrooms needs a custom scope review.';
  }
  if (!customRequired && input.bedrooms > thresholds.bedroomsOver.value) {
    customRequired = true;
    customReason = 'A home this large deserves a custom scope review before we quote it.';
  }
  if (!customRequired && addonSelection.hasCustomQuoteAddon) {
    customRequired = true;
    customReason = 'One of the selected extras is quoted case by case. We will follow up with a custom price for it.';
  }
  if (!customRequired && travel.requiresManualConfirmation) {
    customRequired = true;
    customReason = travel.reason ?? 'This location needs personal confirmation before an instant estimate.';
  }
  if (input.lastClean === 'not_sure') {
    flags.push({
      code: 'CONDITION_UNSURE',
      severity: 'review',
      message: 'We used a conservative estimate because the last-cleaning date was unsure — easy to adjust after we see the home.',
    });
  }
  if (input.pets === 'multiple_shedding') {
    flags.push({
      code: 'MULTIPLE_PETS_NOTE',
      severity: 'info',
      message: 'Multiple shedding pets may need extra time — tell us about them in the notes and we will plan for it.',
    });
  }

  // ── Price math ─────────────────────────────────────────────────────────────
  const rate = pricing.laborEconomics.targetGrossRevenuePerLaborHour.value;
  const minimumJob = pricing.minimumJob.value;
  const rawPrice = labor.hours * rate;
  const priceBeforeTravel = Math.max(minimumJob, rawPrice);
  const minimumApplied = priceBeforeTravel > rawPrice || rawPrice === 0;
  const expectedPrice = priceBeforeTravel + travel.adjustment;

  trace.push(
    { step: 'price:rate', detail: 'Internal gross revenue per labor-hour (never displayed)', value: rate },
    { step: 'price:labor_value', detail: 'Labor hours × internal rate', value: rawPrice },
    { step: 'price:minimum', detail: `Minimum job $${minimumJob}`, value: minimumJob },
    { step: 'price:travel_adjustment', detail: `Travel mode: ${travel.mode}`, value: travel.adjustment },
    { step: 'price:expected', detail: 'Expected price before range spread', value: expectedPrice },
  );

  if (minimumApplied) {
    flags.push({
      code: 'MINIMUM_JOB_APPLIED',
      severity: 'info',
      message: 'Small jobs carry the standard minimum visit value.',
    });
  }

  if (recurringResetSuggested(input.frequency, input.lastClean)) {
    flags.push({
      code: 'INITIAL_DETAILED_CLEAN_SUGGESTED',
      severity: 'info',
      message: pricing.recurringReset.message,
    });
  }

  if (customRequired) {
    flags.push({ code: 'CUSTOM_CONFIRMATION_REQUIRED', severity: 'block', message: customReason });
    return {
      status: 'custom_confirmation_required',
      low: null,
      high: null,
      laborHours: labor.hours,
      expectedPrice: null,
      confidence: 'low',
      flags,
      travel,
      addons: addonSelection.selected,
      minimumApplied,
      trace,
      message: customReason,
    };
  }

  const step = pricing.rounding.toNearest.value;
  const low = Math.max(minimumJob, roundToNearest(expectedPrice * pricing.range.lowFactor.value, step));
  const high = Math.max(low, roundToNearest(expectedPrice * pricing.range.highFactor.value, step));

  // ── Confidence ─────────────────────────────────────────────────────────────
  let score = 1;
  if (travel.mode === 'routed') score += 1;
  if (travel.mode === 'unavailable') score -= 1;
  if (!input.lastClean || input.lastClean === 'not_sure') score -= 1;
  if (input.condition === 'needs_attention' || input.condition === 'heavy') score -= 1;
  const reviewFlags = flags.filter((flag) => flag.severity === 'review').length;
  if (reviewFlags >= 2) score -= 1;
  const confidence: EstimateResult['confidence'] = score >= 2 ? 'high' : score >= 1 ? 'medium' : 'low';

  return {
    status: 'estimated',
    low,
    high,
    laborHours: labor.hours,
    expectedPrice,
    confidence,
    flags,
    travel,
    addons: addonSelection.selected,
    minimumApplied,
    trace,
  };
}
