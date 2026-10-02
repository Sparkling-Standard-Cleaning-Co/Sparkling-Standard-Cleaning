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
  AddonPriceLine,
  CalculationTraceEntry,
  EstimateFlag,
  EstimateInputDraft,
  EstimateResult,
  PricingBreakdown,
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
    /** Optional policy overrides (default to the shared travel config). */
    maxDrivingMinutes?: number;
    reviewBandMinutes?: number;
  };
  /**
   * Optional incentive override (owner tuning / tests). Defaults to the
   * centralized pricing.addonIncentive configuration.
   */
  addonIncentive?: {
    enabled: boolean;
    tiers: Array<{ minAddons: number; percent: number }>;
    maxDiscount?: number | null;
  };
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const EMPTY_TRAVEL: TravelEstimate = {
  mode: 'unavailable',
  zone: 'unknown',
  oneWayMiles: null,
  roundTripMiles: null,
  durationMinutes: null,
  gasPricePerGallon: null,
  gasPriceSource: 'none',
  adjustment: 0,
  requiresManualConfirmation: true,
  method: 'none',
  verified: false,
};

const EMPTY_PRICING: PricingBreakdown = {
  ratePerLaborHour: 0,
  pricingCategory: 'other_services',
  baseLaborHours: 0,
  addonLaborHours: 0,
  totalLaborHours: 0,
  basePrice: 0,
  addonPrices: [],
  selectedExtras: [],
  extrasSubtotal: 0,
  discount: null,
  roundingAdjustment: 0,
  subtotal: 0,
  minimumApplied: false,
};

/** Applies exactly one incentive tier. Returns the effective discount. */
function applyAddonIncentive(input: {
  eligibleAddonCount: number;
  addonSubtotal: number;
  gross: number;
  minimum: number;
  incentive: { enabled: boolean; tiers: Array<{ minAddons: number; percent: number }>; maxDiscount?: number | null };
}): { percent: number; amount: number; label: string } | null {
  if (!input.incentive.enabled || input.eligibleAddonCount < 2 || input.addonSubtotal <= 0) return null;
  const tier = [...input.incentive.tiers]
    .sort((a, b) => b.minAddons - a.minAddons)
    .find((candidate) => input.eligibleAddonCount >= candidate.minAddons);
  if (!tier || tier.percent <= 0) return null;
  const cap = typeof input.incentive.maxDiscount === 'number' ? input.incentive.maxDiscount : Number.POSITIVE_INFINITY;
  const raw = Math.min(round2(input.addonSubtotal * tier.percent), cap, input.addonSubtotal);
  // The discount never pushes the job below the minimum or reduces the base
  // cleaning price; only the effective (price-changing) part is reported.
  const discountedGross = Math.max(input.minimum, input.gross - raw);
  const effective = round2(input.gross - discountedGross);
  if (effective <= 0) return null;
  const percentLabel = `${Math.round(tier.percent * 100)}%`;
  const label =
    input.eligibleAddonCount >= 3
      ? `${percentLabel} off extras (${input.eligibleAddonCount} add-ons)`
      : `${percentLabel} off extras`;
  return { percent: tier.percent, amount: effective, label };
}

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
      pricing: EMPTY_PRICING,
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
  // Option C (owner-approved 2026-10-01): recurring maintenance carries the
  // $42/labor-hour rate; other service categories carry $50/labor-hour.
  // The breakdown below is the ONE authoritative model: the client display,
  // the instant quote and the server verification all render/recompute these
  // exact values.
  const isRecurringMaintenance = input.serviceType === 'standard' && input.frequency !== 'one_time';
  const rate = isRecurringMaintenance
    ? pricing.laborEconomics.recurringGrossRevenuePerLaborHour.value
    : pricing.laborEconomics.targetGrossRevenuePerLaborHour.value;
  const minimumJob = pricing.minimumJob.value;
  const step = pricing.rounding.toNearest.value;
  const baseRaw = labor.baseHours * rate;
  const addonRaw = round2(labor.addonHours * rate);
  const rawPrice = round2(baseRaw + addonRaw);
  const gross = Math.max(minimumJob, rawPrice);
  const minimumApplied = gross > rawPrice;

  const addonPrices: AddonPriceLine[] = pricing.addons.items.map((item) => ({
    id: item.id,
    label: item.label,
    laborHours: item.laborHours ?? 0,
    customQuote: item.customQuote,
    charge: item.customQuote ? null : round2((item.laborHours ?? 0) * rate),
  }));
  const selectedExtras = addonSelection.selected
    .filter((addon) => !addon.customQuote)
    .map((addon) => ({ id: addon.id, label: addon.label, charge: round2(addon.laborHours * rate) }));
  const extrasSubtotal = round2(selectedExtras.reduce((sum, addon) => sum + addon.charge, 0));
  const eligibleAddonCount = selectedExtras.length;

  const incentive = context.addonIncentive ?? {
    enabled: pricing.addonIncentive.enabled.value,
    tiers: pricing.addonIncentive.tiers.map((tier) => ({
      minAddons: tier.minAddons,
      percent: tier.percent.value,
    })),
    maxDiscount: pricing.addonIncentive.maxDiscount.value,
  };
  const discount = applyAddonIncentive({
    eligibleAddonCount,
    addonSubtotal: addonRaw,
    gross,
    minimum: minimumJob,
    incentive,
  });
  const discountedGross = discount ? round2(gross - discount.amount) : gross;
  const expectedPrice = round2(discountedGross + travel.adjustment);
  const roundingAdjustment = round2(roundUpToStep(expectedPrice, step) - expectedPrice);
  const basePrice = round2(Math.max(minimumJob, baseRaw) + travel.adjustment);

  const pricingBreakdown: PricingBreakdown = {
    ratePerLaborHour: rate,
    pricingCategory: isRecurringMaintenance ? 'recurring_maintenance' : 'other_services',
    baseLaborHours: round2(labor.baseHours),
    addonLaborHours: round2(labor.addonHours),
    totalLaborHours: round2(labor.hours),
    basePrice,
    addonPrices,
    selectedExtras,
    extrasSubtotal,
    discount,
    roundingAdjustment,
    subtotal: expectedPrice,
    minimumApplied,
  };

  trace.push(
    { step: 'price:rate', detail: 'Internal gross revenue per labor-hour (never displayed)', value: rate },
    { step: 'price:labor_value', detail: 'Labor hours × internal rate', value: rawPrice },
    { step: 'price:minimum', detail: `Minimum job $${minimumJob}`, value: minimumJob },
    { step: 'price:travel_adjustment', detail: `Travel mode: ${travel.mode}`, value: travel.adjustment },
    ...(discount
      ? [
          {
            step: 'price:addon_incentive',
            detail: `Applied incentive ${discount.label} (single tier, never stacked)`,
            value: discount.amount,
          },
        ]
      : []),
    { step: 'price:rounding', detail: `Rounded up to the nearest $${step}`, value: roundingAdjustment },
    { step: 'price:expected', detail: 'Offered price before the final round-up', value: expectedPrice },
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
      pricing: pricingBreakdown,
      trace,
      message: customReason,
    };
  }

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
    pricing: pricingBreakdown,
    trace,
  };
}
