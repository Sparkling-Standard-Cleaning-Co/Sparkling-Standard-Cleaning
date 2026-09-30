// Travel adjustment math — pure functions, no I/O. Used by the offline zone
// fallback in the browser and by the serverless route function when real
// routing data exists.
//
// PRESENTATION RULE (directive §34): the adjustment is incorporated into the
// estimate total. Customers are never shown a gas-surcharge line item.

import { zonePolicy } from '../../config/geography.ts';
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
    const tooFar = input.routed.oneWayMiles > input.maxInstantDistanceMiles;
    return {
      mode: 'routed',
      zone: input.zone,
      oneWayMiles: input.routed.oneWayMiles,
      roundTripMiles: input.routed.oneWayMiles * 2,
      gasPricePerGallon: gasPrice,
      gasPriceSource,
      adjustment,
      requiresManualConfirmation: tooFar,
      ...(tooFar
        ? {
            reason: `Route distance (${Math.round(input.routed.oneWayMiles)} mi one way) exceeds the instant-estimate range; travel is confirmed personally.`,
          }
        : {}),
    };
  }

  if (input.zone === 'core' || input.zone === 'surrounding') {
    return {
      mode: 'zone',
      zone: input.zone,
      oneWayMiles: null,
      roundTripMiles: null,
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
    gasPricePerGallon: null,
    gasPriceSource: 'none',
    adjustment: 0,
    requiresManualConfirmation: !policy.instantEstimate,
    reason: policy.manualReason,
  };
}
