// Estimator types — shared by the browser flow, the serverless function, and
// the unit test suite. This module must stay free of browser/node-specific
// APIs so it can run in every context.

import type {
  Condition,
  Frequency,
  LastProfessionalClean,
  PricingServiceType,
} from '../../config/pricing.ts';
import type { ServiceZone } from '../../config/geography.ts';

export type ServiceType = PricingServiceType;
export type { Condition, Frequency, LastProfessionalClean, ServiceZone };

export type PropertyType = 'house' | 'apartment' | 'condo' | 'townhome' | 'other';
export type PetSituation = 'none' | 'one' | 'multiple_shedding';

/** Raw, user-supplied estimator input (already parsed from the form). */
export interface EstimateInput {
  serviceType: ServiceType;
  propertyType?: PropertyType;
  squareFeet: number;
  bedrooms: number;
  /** Full bathrooms. */
  fullBaths: number;
  /** Half bathrooms. */
  halfBaths: number;
  /** Beds to reset — STR turnovers only. */
  beds?: number;
  frequency: Frequency;
  condition: Condition;
  lastClean?: LastProfessionalClean;
  addonIds: string[];
  zip: string;
  /**
   * True when the customer confirmed a destination pin (GPS or map pin) and a
   * ZIP is genuinely unavailable. Travel then comes from the confirmed
   * coordinates; the request stays preliminary, never verified postal data.
   */
  destinationConfirmed?: boolean;
  pets?: PetSituation;
  /**
   * Customer self-attestation that they qualify for the Supportive Home 10%
   * discount (65+, veteran, or disability). Optional; never inferred from a
   * sensitive category and never required to receive ordinary cleaning.
   */
  supportiveEligible?: boolean;
}

/** Form-collected draft: any field may be absent or explicitly undefined. */
export type EstimateInputDraft = {
  [K in keyof EstimateInput]?: EstimateInput[K] | undefined;
};

/** Normalized input after validation — every field is safe to compute with. */
export interface NormalizedEstimateInput extends EstimateInput {
  normalizedZip: string;
}

export type FlagSeverity = 'info' | 'review' | 'block';

export interface EstimateFlag {
  code:
    | 'CUSTOM_CONFIRMATION_REQUIRED'
    | 'INITIAL_DEEP_CLEAN_REQUIRED'
    | 'INITIAL_DETAILED_CLEAN_SUGGESTED'
    | 'MINIMUM_JOB_APPLIED'
    | 'EXTENDED_AREA_CONFIRMATION'
    | 'OUTSIDE_AREA_CONFIRMATION'
    | 'UNKNOWN_LOCATION'
    | 'TRAVEL_ORIGIN_PENDING'
    | 'CONDITION_UNSURE'
    | 'LARGE_PROPERTY_REVIEW'
    | 'MULTIPLE_PETS_NOTE'
    | 'STR_SAME_DAY_NOTE'
    | 'NO_GAS_PRICE_REFERENCE'
    | 'FOUNDING_UPGRADE_GRANTED'
    | 'GLOBAL_FACTOR_BELOW_FLOOR';
  message: string;
  severity: FlagSeverity;
}

export interface SelectedAddon {
  id: string;
  label: string;
  laborHours: number;
  /**
   * Owner-set fixed charge in USD, when one exists. The charge resolver uses
   * it instead of laborHours × rate; laborHours still count toward labor time.
   */
  fixedPriceUsd?: number;
  customQuote: boolean;
}

/** One priced (non-specialty) add-on for the transparency display. */
export interface AddonPriceLine {
  id: string;
  label: string;
  /** Labor-derived charge in USD, or null for specialty "custom quote" work. */
  charge: number | null;
  customQuote: boolean;
  laborHours: number;
}

/**
 * Transparent price breakdown produced by the SAME calculation that produces
 * the estimate and the quote. The client renders these values and the server
 * recomputes them identically for the owner notification.
 */
export interface PricingBreakdown {
  /** Internal gross revenue per labor-hour actually applied (owner only). */
  ratePerLaborHour: number;
  /** Which approved Option C category the rate came from. */
  pricingCategory: 'recurring_maintenance' | 'other_services';
  baseLaborHours: number;
  addonLaborHours: number;
  totalLaborHours: number;
  /** Base cleaning price after the minimum, rounded to the presentation step. */
  basePrice: number;
  /** Separately stated travel pass-through; never discounted or factored. */
  travelAdjustment: number;
  /** Every add-on with its charge at the current service/scope. */
  addonPrices: AddonPriceLine[];
  /** Selected eligible extras (subset of addonPrices), exact cents. */
  selectedExtras: Array<{ id: string; label: string; charge: number }>;
  extrasSubtotal: number;
  /**
   * The single applied promotion (never stacked), or null when none is
   * active. `id`/`source` identify the exact configured program so a quote's
   * provenance is auditable.
   */
  discount: {
    id?: string;
    source?: string;
    percent: number;
    amount: number;
    label: string;
  } | null;
  /** proposedTotal − (basePrice + extrasSubtotal − discountAmount); ≥ 0. */
  roundingAdjustment: number;
  /** The offered price before the $5 round-up (expectedPrice equivalent). */
  subtotal: number;
  /** Owner-controlled global estimate factor applied to the service subtotal. */
  globalFactor: number;
  /** Dollar effect of the global factor (negative = reduction). */
  globalAdjustment: number;
  /** True when the minimum job value raised the price. */
  minimumApplied: boolean;
}

export interface TravelEstimate {
  /**
   * zone      — offline reference zones (no routing configured/reachable)
   * routed    — server function returned a real route distance
   * unavailable — no usable travel information; estimate proceeds and travel
   *               is confirmed manually
   */
  mode: 'zone' | 'routed' | 'unavailable';
  zone: ServiceZone;
  oneWayMiles: number | null;
  roundTripMiles: number | null;
  /** Routed driving duration in minutes when the provider returned one. */
  durationMinutes: number | null;
  /**
   * Driving-time policy outcome for routed trips. 'within' is the ordinary
   * boundary; 'review_band' is the approved additional band; 'beyond' needs
   * personal confirmation. Undefined when no routed duration exists.
   */
  drivingTimeStatus?: 'within' | 'review_band' | 'beyond';
  gasPricePerGallon: number | null;
  gasPriceSource: 'eia_live' | 'configured_reference' | 'none';
  adjustment: number;
  requiresManualConfirmation: boolean;
  /**
   * How travel was established:
   *  - 'route' — a live provider route from the private operating origin
   *    (the only mode that counts as verified travel);
   *  - 'straight_line_estimate' — road-distance approximation, preliminary;
   *  - 'zone' — provisional ZIP zone fallback, preliminary;
   *  - 'none' — no usable travel information.
   */
  method: 'route' | 'straight_line_estimate' | 'zone' | 'none';
  /** True ONLY for a live provider route; preliminary otherwise. */
  verified: boolean;
  reason?: string | undefined;
}

export interface CalculationTraceEntry {
  step: string;
  detail: string;
  value?: number | string;
}

/**
 * Ongoing per-visit summary for a NEW recurring residential arrangement.
 * Owner policy: the first visit is the required Deep Cleaning, so the primary
 * result prices that first visit; this summary prices the recurring rhythm
 * that starts on the second visit. Present only when the policy applies
 * (standard service + recurring frequency).
 */
export interface OngoingVisitSummary {
  /** The recurring rhythm the customer chose (weekly / biweekly / monthly). */
  frequency: Frequency;
  /**
   * The ongoing per-visit price, rounded with the SAME instant-quote rule as
   * the primary price (margin floor + minimum job + round-up step).
   */
  perVisitPrice: number;
  /** Model price before the final round-up (transparency/debug only). */
  modelPrice: number;
  /** Typical low/high per-visit range for the ongoing rhythm. */
  range: { low: number; high: number };
  laborHours: number;
  /** Transparent breakdown of the ongoing per-visit price. */
  pricing: PricingBreakdown;
}

export interface EstimateResult {
  status: 'estimated' | 'custom_confirmation_required' | 'invalid';
  low: number | null;
  high: number | null;
  laborHours: number | null;
  /** Base expected price before the guestimator range spread. Internal. */
  expectedPrice: number | null;
  confidence: 'high' | 'medium' | 'low';
  flags: EstimateFlag[];
  travel: TravelEstimate;
  addons: SelectedAddon[];
  minimumApplied: boolean;
  /** Transparent price breakdown — the same numbers the quote is built from. */
  pricing: PricingBreakdown;
  /**
   * Present when this result prices a NEW recurring residential arrangement:
   * the primary numbers above are the required first-visit Deep Cleaning and
   * `ongoing` summarizes the recurring per-visit price that follows it.
   */
  ongoing?: OngoingVisitSummary;
  /** Internal calculation trace — never rendered publicly (preview debug/tests only). */
  trace: CalculationTraceEntry[];
  /** Present when status is 'invalid'. */
  issues?: string[];
  /** Customer-safe summary line when custom confirmation is required. */
  message?: string;
}

/** What the optional serverless travel function returns. */
export interface RoutedTravelInfo {
  oneWayMiles: number;
  /** Driving duration in minutes when the provider returns one. */
  durationMinutes?: number | null;
  /** Optional live gas price in USD/gal from the configured provider. */
  gasPrice: number | null;
  gasPriceSource: 'eia_live' | 'configured_reference' | 'none';
  provider: string;
  /** Server-reported derivation; 'route' is a live provider route. */
  method?: 'route' | 'straight_line_estimate';
  /** Server-reported verification flag; true only for a live provider route. */
  verified?: boolean;
}
