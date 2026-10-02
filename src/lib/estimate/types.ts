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
  pets?: PetSituation;
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
    | 'NO_GAS_PRICE_REFERENCE';
  message: string;
  severity: FlagSeverity;
}

export interface SelectedAddon {
  id: string;
  label: string;
  laborHours: number;
  customQuote: boolean;
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
