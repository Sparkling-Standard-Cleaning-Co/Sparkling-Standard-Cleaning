// Travel adjustment math — pure functions, no I/O. Used by the offline zone
// fallback in the browser and by the serverless route function when real
// routing data exists.
//
// PRESENTATION RULE (directive §34): the adjustment is incorporated into the
// estimate total. Customers are never shown a gas-surcharge line item.

import { zonePolicy } from '../../config/geography.ts';
import { travelConfig } from '../../config/travel.ts';
import type { ServiceZone, TravelEstimate, RoutedTravelInfo } from '../estimate/types.ts';

export interface TravelCalculationInput {
  zone: ServiceZone;
  /** Present only when the serverless routing function answered. */
  routed?: RoutedTravelInfo | undefined;
  includedOneWayMiles: number;
  /** Vehicle efficiency used by the server-side route calculation. */
  mpg: number;
  wearPerMile: number;
  referenceGasPrice: number;
  zoneAdjustments: { core: number; surrounding: number };
  maxInstantDistanceMiles: number;
  /** Ordinary driving-time boundary in minutes (defaults to the shared config). */
  maxDrivingMinutes?: number | undefined;
  /** Additional review band beyond the boundary (defaults to the shared config). */
  reviewBandMinutes?: number | undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Route-mode adjustment: round-trip fuel for the miles beyond the included
 * allowance, plus a per-mile wear allowance. Never negative.
 */
export function routedAdjustment(input: {
  oneWayMiles: number;
  includedOneWayMiles: number;
  mpg: number;
  gasPrice: number;
  wearPerMile: number;
}): number {
  const extraOneWay = Math.max(0, input.oneWayMiles - input.includedOneWayMiles);
  const roundTripMiles = extraOneWay * 2;
  const safeMpg = input.mpg > 0 ? input.mpg : 24;
  const fuel = (roundTripMiles / safeMpg) * input.gasPrice;
  const wear = roundTripMiles * input.wearPerMile;
  return round2(fuel + wear);
}

export function calculateTravelAdjustment(input: TravelCalculationInput): TravelEstimate {
  const policy = zonePolicy[input.zone];

  if (input.routed) {
    const gasPrice = input.routed.gasPrice ?? input.referenceGasPrice;
    const gasPriceSource =
      input.routed.gasPrice === null ? ('configured_reference' as const) : input.routed.gasPriceSource;
    const adjustment = routedAdjustment({
      oneWayMiles: input.routed.oneWayMiles,
      includedOneWayMiles: input.includedOneWayMiles,
      mpg: input.mpg,
      gasPrice,
      wearPerMile: input.wearPerMile,
    });

    // Driving-time policy (owner-approved boundary + review band). When the
    // provider answered with a duration, minutes decide eligibility — not the
    // provisional ZIP zone and not straight-line miles.
    const maxMinutes = input.maxDrivingMinutes ?? travelConfig.maxDrivingMinutes;
    const reviewBand = input.reviewBandMinutes ?? travelConfig.reviewBandMinutes;
    const durationMinutes =
      typeof input.routed.durationMinutes === 'number' && input.routed.durationMinutes > 0
        ? input.routed.durationMinutes
        : null;

    let drivingTimeStatus: TravelEstimate['drivingTimeStatus'];
    let requiresManualConfirmation = false;
    let reason: string | undefined;

    if (durationMinutes !== null) {
      if (durationMinutes <= maxMinutes) {
        drivingTimeStatus = 'within';
      } else if (durationMinutes <= maxMinutes + reviewBand) {
        drivingTimeStatus = 'review_band';
        requiresManualConfirmation = true;
        reason = `About ${Math.round(durationMinutes)} minutes of driving is just beyond our usual instant-estimate boundary, so we confirm it personally before booking.`;
      } else {
        drivingTimeStatus = 'beyond';
        requiresManualConfirmation = true;
        reason = `About ${Math.round(durationMinutes)} minutes of driving is beyond our usual service boundary — send a request anyway and we will tell you honestly whether we can help.`;
      }
    } else {
      // Distance-only provider answer: keep the hard safety cap.
      requiresManualConfirmation = input.routed.oneWayMiles > input.maxInstantDistanceMiles;
      if (requiresManualConfirmation) {
        reason = `Route distance (${Math.round(input.routed.oneWayMiles)} mi one way) exceeds the instant-estimate range; travel is confirmed personally.`;
      }
    }

    return {
      mode: 'routed',
      zone: input.zone,
      oneWayMiles: input.routed.oneWayMiles,
      roundTripMiles: input.routed.oneWayMiles * 2,
      durationMinutes,
      ...(drivingTimeStatus ? { drivingTimeStatus } : {}),
      gasPricePerGallon: gasPrice,
      gasPriceSource,
      adjustment,
      requiresManualConfirmation,
      ...(reason ? { reason } : {}),
    };
  }

  if (input.zone === 'core' || input.zone === 'surrounding') {
    return {
      mode: 'zone',
      zone: input.zone,
      oneWayMiles: null,
      roundTripMiles: null,
      durationMinutes: null,
      gasPricePerGallon: null,
      gasPriceSource: 'none',
      adjustment: input.zoneAdjustments[input.zone],
      requiresManualConfirmation: false,
    };
  }

  return {
    mode: input.zone === 'extended' || input.zone === 'outside' ? 'zone' : 'unavailable',
    zone: input.zone,
    oneWayMiles: null,
    roundTripMiles: null,
    durationMinutes: null,
    gasPricePerGallon: null,
    gasPriceSource: 'none',
    adjustment: 0,
    requiresManualConfirmation: !policy.instantEstimate,
    reason: policy.manualReason,
  };
}
