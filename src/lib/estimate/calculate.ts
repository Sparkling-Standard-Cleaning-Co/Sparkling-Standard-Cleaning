// Estimate orchestrator — turns raw input + travel context into the customer
// estimate range, review flags, confidence and an internal calculation trace.
//
// Fail-safe rules:
//  - invalid input returns status 'invalid' with no numbers;
//  - thresholds / severe condition / custom add-ons / out-of-range travel
//    return 'custom_confirmation_required' instead of fake precision;
//  - the minimum job value is applied silently to every estimate;
//  - prices are never negative or nonsensical.

import { pricing, resolveGlobalEstimateFactor } from '../../config/pricing.ts';
import { zoneForZip } from '../../config/geography.ts';
import type { AddonBundleDefinition, CampaignPromotionConfig, FoundingTenConfig, PromotionCustomerKind, PromotionTerms } from '../../config/owner-pricing.ts';
import { calculateTravelAdjustment } from '../travel/calculateTravelAdjustment.ts';
import { resolveAddonCharge, selectAddons } from './addons.ts';
import { computeLaborHours } from './labor.ts';
import { recurringResetSuggested, requiresInitialDeepClean } from './frequency.ts';
import { schedulingConfig } from '../../config/scheduling.ts';
import { evaluatePromotions } from './promotions.ts';
import { selectInstantAmount } from './quote.ts';
import { validateEstimateInput } from './validation.ts';
import type {
  AddonPriceLine,
  CalculationTraceEntry,
  EstimateFlag,
  EstimateInputDraft,
  EstimateResult,
  Frequency,
  NormalizedEstimateInput,
  OngoingVisitSummary,
  PricingBreakdown,
  RoutedTravelInfo,
  ServiceType,
  TravelEstimate,
} from './types.ts';

export interface EstimateContext {
  /** Test/owner override for the global estimate factor; defaults to config. */
  globalEstimateFactor?: number;
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
  /**
   * Optional promotion overrides (tests / future owner flows). Defaults to
   * the centralized, DISABLED pricing.promotions configuration. The same
   * evaluator runs on the server, so eligibility cannot drift between the
   * browser quote and the verified quote.
   */
  promotions?: {
    appreciationDiscounts?: PromotionTerms[];
    addonBundles?: AddonBundleDefinition[];
    foundingTen?: FoundingTenConfig;
    /** What the flow can prove about the customer. 'unknown' fails closed. */
    customerKind?: 'unknown' | PromotionCustomerKind;
    /** ISO date used for expiry checks; defaults to today (UTC). */
    todayIso?: string;
    /**
     * The claim-based welcome campaign. Defaults to the centralized
     * pricing.promotions.campaign configuration; null disables it (tests).
     */
    campaign?: CampaignPromotionConfig | null;
    /**
     * The code the customer claimed (popup CTA / campaign link). Never
     * trusted for anything else: the engine re-checks eligibility itself.
     */
    claimedCampaignCode?: string | null;
    /**
     * P12: when a NEW recurring arrangement prices its required first visit
     * as a Deep Cleaning, this override carries the customer's actual
     * arrangement (standard + their chosen frequency) so the campaign terms
     * are checked against the arrangement, not the internal first-visit
     * computation shape. Set automatically by calculateEstimate; callers
     * never need to provide it.
     */
    campaignArrangement?: { serviceType: ServiceType; frequency: Frequency } | null;
  };
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Presented prices round DOWN to the owner-approved $5 increment. */
function floorToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function round2(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
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
  travelAdjustment: 0,
  addonPrices: [],
  selectedExtras: [],
  extrasSubtotal: 0,
  discount: null,
  roundingAdjustment: 0,
  subtotal: 0,
  globalFactor: 1,
  globalAdjustment: 0,
  minimumApplied: false,
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
      pricing: EMPTY_PRICING,
      trace: [],
      issues: validation.issues,
      message: 'We need a little more information to estimate this clean.',
    };
  }

  const input = validation.input;

  // ── P12: first Deep Cleaning vs ongoing per-visit price ─────────────────────
  // A NEW recurring residential arrangement (standard service + recurring
  // frequency) is quoted as its required FIRST VISIT — a Deep Cleaning
  // computed at the deep/one-time rate — while `ongoing` summarizes the
  // recurring per-visit price that starts on the second visit. The primary
  // numbers (and the price the customer submits) are the first visit, and
  // the server recomputes both identically because the split lives here in
  // the one model — never in the browser display or the server function.
  if (!requiresInitialDeepClean(input.serviceType, input.frequency)) {
    return computeCore(input, context);
  }

  const firstVisit = computeCore(
    { ...input, serviceType: 'deep', frequency: 'one_time' },
    {
      ...context,
      promotions: {
        ...context.promotions,
        // Campaign eligibility follows the customer's actual arrangement
        // (e.g. standard + weekly), not the internal first-visit shape.
        campaignArrangement: { serviceType: input.serviceType, frequency: input.frequency },
      },
    },
  );
  if (firstVisit.status !== 'estimated') {
    // The custom-confirmation gates depend on the home, extras and travel —
    // not on service/frequency — so the ongoing rhythm hits the same
    // outcome; nothing instant is shown either way.
    return firstVisit;
  }

  // The welcome campaign is a first-clean offer: it never discounts the
  // ongoing rhythm, whatever the customer claimed.
  const ongoing = computeCore(input, {
    ...context,
    promotions: {
      ...context.promotions,
      claimedCampaignCode: null,
      campaignArrangement: null,
    },
  });

  const ongoingSummary: OngoingVisitSummary | undefined =
    ongoing.status === 'estimated' && ongoing.expectedPrice !== null
      ? {
          frequency: input.frequency,
          perVisitPrice: selectInstantAmount(ongoing) ?? ongoing.expectedPrice,
          modelPrice: ongoing.expectedPrice,
          range: {
            low: ongoing.low ?? ongoing.expectedPrice,
            high: ongoing.high ?? ongoing.expectedPrice,
          },
          laborHours: ongoing.laborHours ?? 0,
          pricing: ongoing.pricing,
        }
      : undefined;

  // The merged flags price the FIRST visit; the ongoing rhythm contributes
  // only the informational first-visit requirement (its other flags — e.g. a
  // minimum applied to the smaller ongoing visit — would describe a price
  // that is not the one being quoted here).
  const flags = [...firstVisit.flags];
  if (!flags.some((flag) => flag.code === 'INITIAL_DEEP_CLEAN_REQUIRED')) {
    flags.push({
      code: 'INITIAL_DEEP_CLEAN_REQUIRED',
      severity: 'info',
      message: schedulingConfig.recurringResidential.message,
    });
  }

  const trace: CalculationTraceEntry[] = [
    ...firstVisit.trace,
    {
      step: 'arrangement:first_visit',
      detail: 'New recurring arrangement — the required first visit is a Deep Cleaning',
      ...(firstVisit.expectedPrice !== null ? { value: firstVisit.expectedPrice } : {}),
    },
    ...(ongoingSummary
      ? [
          {
            step: 'arrangement:ongoing',
            detail: `Ongoing ${input.frequency} per-visit price after the first deep clean`,
            value: ongoingSummary.modelPrice,
          },
        ]
      : []),
  ];

  return {
    ...firstVisit,
    flags,
    trace,
    ...(ongoingSummary ? { ongoing: ongoingSummary } : {}),
  };
}

/**
 * One complete single-visit computation: travel, labor, custom-confirmation
 * gates, rate, promotions, breakdown, confidence and range. Pure — the P12
 * recurring split above is the only behavior layered on top of it.
 */
function computeCore(input: NormalizedEstimateInput, context: EstimateContext): EstimateResult {
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

  // Every non-specialty add-on charge resolves through ONE helper: the
  // owner-set fixed price when present, otherwise labor-hours × rate. The
  // add-on subtotal is the sum of those resolved charges, so a fixed-price
  // item feeds the total exactly as displayed. Labor-hours (including a
  // fixed-price item's hours) still come from the labor model for scheduling.
  const addonPrices: AddonPriceLine[] = pricing.addons.items.map((item) => ({
    id: item.id,
    label: item.label,
    laborHours: item.laborHours ?? 0,
    customQuote: item.customQuote,
    charge: resolveAddonCharge(item, rate),
  }));
  const selectedExtras = addonSelection.selected
    .filter((addon) => !addon.customQuote)
    .map((addon) => ({ id: addon.id, label: addon.label, charge: resolveAddonCharge(addon, rate) ?? 0 }));
  const extrasSubtotal = round2(selectedExtras.reduce((sum, addon) => sum + addon.charge, 0));
  const addonRaw = extrasSubtotal;

  const rawPrice = round2(baseRaw + addonRaw);
  const gross = Math.max(minimumJob, rawPrice);
  const minimumApplied = gross > rawPrice;
  // 1. Base service price after the minimum, rounded to the owner-approved
  //     presentation step BEFORE any discount or global adjustment. This
  //    keeps a  campaign exactly  off the displayed base price.
  const baseRounded = floorToStep(gross, step);

  const incentive = context.addonIncentive ?? {
    enabled: pricing.addonIncentive.enabled.value,
    tiers: pricing.addonIncentive.tiers.map((tier) => ({
      minAddons: tier.minAddons,
      percent: tier.percent.value,
    })),
    maxDiscount: pricing.addonIncentive.maxDiscount.value,
  };
  const evaluation = evaluatePromotions({
    serviceType: input.serviceType,
    frequency: input.frequency,
    eligibleAddonIds: selectedExtras.map((extra) => extra.id),
    addonChargesById: Object.fromEntries(selectedExtras.map((extra) => [extra.id, extra.charge])),
    addonSubtotal: addonRaw,
    gross: baseRounded,
    minimumJob,
    todayIso: context.promotions?.todayIso ?? new Date().toISOString().slice(0, 10),
    customerKind: context.promotions?.customerKind ?? 'unknown',
    addonIncentive: incentive,
    appreciationDiscounts: context.promotions?.appreciationDiscounts ?? pricing.promotions.appreciationDiscounts,
    addonBundles: context.promotions?.addonBundles ?? pricing.promotions.addonBundles,
    foundingTen: context.promotions?.foundingTen ?? pricing.promotions.foundingTen,
    campaign: context.promotions?.campaign !== undefined ? context.promotions.campaign : pricing.promotions.campaign.value,
    claimedCampaignCode: context.promotions?.claimedCampaignCode ?? null,
    campaignArrangement: context.promotions?.campaignArrangement ?? null,
    supportiveDiscount: {
      enabled: pricing.supportiveHomeDiscount.enabled.value,
      percent: pricing.supportiveHomeDiscount.percent.value,
      eligibleServices: pricing.supportiveHomeDiscount.eligibleServices.value,
    },
    supportiveEligible: input.supportiveEligible === true,
  });
  const discount = evaluation.discount;
  // 2. One discount (never stacked) applies to the rounded base.
  const discountedBase = discount ? round2(baseRounded - discount.amount) : baseRounded;
  // 3. The owner global factor applies to the discounted service subtotal.
  const globalFactor = resolveGlobalEstimateFactor(context.globalEstimateFactor);
  const adjustedBase = round2(discountedBase * globalFactor);
  const globalAdjustment = round2(adjustedBase - discountedBase);
  // 4. Travel is a separately stated pass-through; tax is never included here.
  const expectedPrice = round2(adjustedBase + travel.adjustment);
  const hasAdjustment = discount !== null || globalFactor !== 1;
  // 5. The base was rounded before discounts. The breakdown presents the
  //    unrounded base + extras + the presentation adjustment separately so
  //    the customer can reconcile every line exactly.
  const roundingAdjustment = minimumApplied ? 0 : round2(baseRounded - baseRaw - addonRaw);
  const basePrice = minimumApplied ? baseRounded : round2(baseRaw);

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
    travelAdjustment: travel.adjustment,
    roundingAdjustment,
    subtotal: expectedPrice,
    globalFactor,
    globalAdjustment,
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
            step: 'price:promotion',
            detail: `Applied discount "${discount.label}" [${discount.id}] (single discount, never stacked)`,
            value: discount.amount,
          },
        ]
      : []),
    ...(globalFactor !== 1
      ? [
          {
            step: 'price:global_factor',
            detail: `Owner global estimate factor × ${globalFactor.toFixed(2)} applied to the pre-tax service subtotal`,
            value: globalAdjustment,
          },
        ]
      : []),
    { step: 'price:base_rounding', detail: `Base service rounded down to the nearest $${step}`, value: round2(baseRounded - gross) },
    { step: 'price:rounding', detail: 'Discounts and the owner factor are preserved to the cent; no upward rounding or reapplied minimum', value: roundingAdjustment },
    { step: 'price:expected', detail: 'Offered price before travel/tax presentation', value: expectedPrice },
  );

  if (globalFactor < 1 && adjustedBase < minimumJob) {
    flags.push({
      code: 'GLOBAL_FACTOR_BELOW_FLOOR',
      severity: 'review',
      message:
        'The owner global estimate factor takes this service subtotal below the standard minimum; review before confirming.',
    });
  }

  if (minimumApplied) {
    flags.push({
      code: 'MINIMUM_JOB_APPLIED',
      severity: 'info',
      message: 'Small jobs carry the standard minimum visit value.',
    });
  }

  if (evaluation.grant) {
    flags.push({
      code: 'FOUNDING_UPGRADE_GRANTED',
      severity: 'info',
      message:
        'A complimentary founding-customer upgrade applies to this request; the owner confirms it personally.',
    });
  }

  if (requiresInitialDeepClean(input.serviceType, input.frequency)) {
    flags.push({
      code: 'INITIAL_DEEP_CLEAN_REQUIRED',
      severity: 'info',
      message: schedulingConfig.recurringResidential.message,
    });
  } else if (recurringResetSuggested(input.frequency, input.lastClean)) {
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

  const low = hasAdjustment
    ? round2(expectedPrice * pricing.range.lowFactor.value)
    : Math.max(minimumJob, roundToNearest(expectedPrice * pricing.range.lowFactor.value, step));
  const high = hasAdjustment
    ? round2(expectedPrice * pricing.range.highFactor.value)
    : Math.max(low, roundToNearest(expectedPrice * pricing.range.highFactor.value, step));

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
