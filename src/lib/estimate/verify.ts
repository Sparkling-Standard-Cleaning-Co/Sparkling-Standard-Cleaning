// Reservation quote verification — the authoritative server-side recompute.
//
// The browser is NEVER trusted for prices, travel cost, distance, duration or
// coordinates. This module:
//   1. parses the structured reservation fields the customer submitted,
//   2. resolves the destination address itself (MapMap → Census → ZIP centroid)
//      instead of accepting client coordinates,
//   3. computes the route from the private operating origin to that
//      server-resolved destination,
//   4. re-runs the exact same estimator + pricing configuration the browser
//      used (same shared config modules — no second pricing algorithm), and
//   5. compares the server price to the client-quoted price, returning
//      'match' | 'mismatch' | 'unverifiable' with a plain-language note.
//
// The private origin and provider keys live only in the function environment
// and are never included in any returned value.

import { pricing } from '../../config/pricing.ts';
import { travelConfig } from '../../config/travel.ts';
import { zipReference } from '../../config/geography.ts';
import { calculateEstimate, type EstimateContext } from './calculate.ts';
import { selectInstantAmount } from './quote.ts';
import { validateEstimateInput } from './validation.ts';
import type { EstimateInputDraft, RoutedTravelInfo } from './types.ts';
import {
  configuredReferenceGasPrice,
  gulfCoastGasPrice,
  parseLatLng,
  resolveRoute,
  type RoutingEnv,
} from '../travel/server-routing.ts';
import { resolveAddress, type GeocodeEnv } from '../location/server-geocode.ts';

export interface QuoteVerificationEnv extends RoutingEnv, GeocodeEnv {}

export type QuoteVerificationStatus = 'match' | 'mismatch' | 'unverifiable';

export interface QuoteVerificationTravel {
  method: 'route' | 'straight_line_estimate' | 'zone';
  provider: string;
  oneWayMiles: number | null;
  durationMinutes: number | null;
  /** True only when a live provider route was used. */
  verified: boolean;
  /** How the server established the destination point. */
  destinationSource: 'address_geocode' | 'zip_centroid' | 'none';
}

export interface QuoteVerification {
  status: QuoteVerificationStatus;
  clientPrice: number | null;
  verifiedPrice: number | null;
  verifiedRange: { low: number; high: number } | null;
  /** Server configuration version that produced the verified price. */
  configVersion: string;
  clientConfigVersion: string | null;
  clientReference: string | null;
  travel: QuoteVerificationTravel;
  /** Plain-language verdict for the owner notification. */
  note: string;
  verifiedAt: string;
  validThrough: string;
}

/** Price agreement tolerance (USD): covers provider/rounding variance. */
export const QUOTE_MATCH_TOLERANCE = 10;

function numberFrom(fields: Record<string, string>, key: string): number | undefined {
  const raw = fields[key];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Maps the flat reservation fields to the estimator's draft shape. Unknown
 * values are dropped rather than coerced, so validation fails closed.
 */
export function mapReservationFields(fields: Record<string, string>): EstimateInputDraft {
  const addonIds = (fields.addon_ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    serviceType: fields.service_type as EstimateInputDraft['serviceType'],
    propertyType: fields.property_type as EstimateInputDraft['propertyType'],
    squareFeet: numberFrom(fields, 'square_feet'),
    bedrooms: numberFrom(fields, 'bedrooms'),
    fullBaths: numberFrom(fields, 'full_baths'),
    halfBaths: numberFrom(fields, 'half_baths') ?? 0,
    beds: numberFrom(fields, 'beds'),
    frequency: fields.frequency as EstimateInputDraft['frequency'],
    condition: fields.condition as EstimateInputDraft['condition'],
    lastClean: fields.last_cleaned as EstimateInputDraft['lastClean'],
    addonIds,
    zip: fields.zip ?? '',
    pets: fields.pets as EstimateInputDraft['pets'],
  };
}

function buildEstimateContext(routed: RoutedTravelInfo | undefined): EstimateContext {
  return {
    travel: {
      ...(routed ? { routed } : {}),
      includedOneWayMiles: travelConfig.includedOneWayMiles,
      mpg: travelConfig.mpg,
      wearPerMile: travelConfig.wearPerMile,
      referenceGasPrice: travelConfig.fallbackGasPrice,
      zoneAdjustments: {
        core: pricing.travel.zoneAdjustments.core.value,
        surrounding: pricing.travel.zoneAdjustments.surrounding.value,
      },
      maxInstantDistanceMiles: travelConfig.maxInstantDistanceMiles,
      maxDrivingMinutes: travelConfig.maxDrivingMinutes,
      reviewBandMinutes: travelConfig.reviewBandMinutes,
    },
  };
}

interface ServerDestination {
  lat: number;
  lng: number;
  source: QuoteVerificationTravel['destinationSource'];
}

/**
 * Resolves the destination server-side. Client-submitted coordinates are
 * deliberately ignored. Address geocoding is attempted first; the provisional
 * ZIP centroid is only a fallback.
 */
export async function resolveServerDestination(
  fields: Record<string, string>,
  env: QuoteVerificationEnv,
): Promise<ServerDestination | null> {
  const street = (fields.service_address ?? '').trim();
  const unit = (fields.address_unit ?? '').trim();
  const zip = (fields.zip ?? '').trim();

  if (street.length >= 5) {
    const queryParts = [unit ? `${street} ${unit}` : street, zip].filter(Boolean);
    const resolved = await resolveAddress(env, queryParts.join(', ')).catch(() => null);
    if (resolved) return { lat: resolved.lat, lng: resolved.lng, source: 'address_geocode' };
  }

  const zipMatch = zip.match(/^(\d{5})(?:-\d{4})?$/);
  if (zipMatch) {
    const reference = zipReference[zipMatch[1] as string];
    if (reference) return { lat: reference.lat, lng: reference.lng, source: 'zip_centroid' };
  }

  return null;
}

/**
 * Verifies a reservation's quote. `now` is injectable for deterministic tests.
 * This function never throws for a verification problem; a failure to verify
 * returns 'unverifiable' so the customer request is still delivered.
 */
export async function verifyReservationQuote(
  fields: Record<string, string>,
  env: QuoteVerificationEnv,
  now: number = Date.now(),
): Promise<QuoteVerification> {
  const configVersion = pricing.instantQuote.configVersion.value;
  const clientConfigVersion = fields.quote_config_version?.trim() || null;
  const clientReference = fields.quote_reference?.trim() || null;
  const clientPrice = numberFrom(fields, 'quoted_price') ?? null;
  const travel: QuoteVerificationTravel = {
    method: 'zone',
    provider: 'none',
    oneWayMiles: null,
    durationMinutes: null,
    verified: false,
    destinationSource: 'none',
  };
  const result = (
    status: QuoteVerificationStatus,
    verifiedPrice: number | null,
    verifiedRange: { low: number; high: number } | null,
    note: string,
  ): QuoteVerification => ({
    status,
    clientPrice,
    verifiedPrice,
    verifiedRange,
    configVersion,
    clientConfigVersion,
    clientReference,
    travel,
    note,
    verifiedAt: new Date(now).toISOString(),
    validThrough: new Date(now + pricing.instantQuote.validityHours.value * 3_600_000).toISOString(),
  });

  const draft = mapReservationFields(fields);
  const validation = validateEstimateInput(draft);
  if (!validation.ok) {
    return result('unverifiable', null, null, `Could not verify: ${validation.issues[0] ?? 'incomplete request details'}.`);
  }

  // Server-side destination + route (client coordinates are never used).
  const destination = await resolveServerDestination(fields, env).catch(() => null);
  const origin = parseLatLng(env.TRAVEL_ORIGIN);

  let routed: RoutedTravelInfo | undefined;
  if (origin && destination) {
    travel.destinationSource = destination.source;
    const route = await resolveRoute(env, origin, destination).catch(() => null);
    if (route) {
      const gas = await gulfCoastGasPrice(
        env.EIA_API_KEY?.trim(),
        configuredReferenceGasPrice(env),
      ).catch(() => ({ gasPrice: configuredReferenceGasPrice(env), gasPriceSource: 'configured_reference' as const }));
      routed = {
        oneWayMiles: route.oneWayMiles,
        durationMinutes: route.durationMinutes,
        gasPrice: gas.gasPrice,
        gasPriceSource: gas.gasPriceSource,
        provider: route.provider,
        method: route.method,
        verified: route.verified,
      };
      travel.method = route.method;
      travel.provider = route.provider;
      travel.oneWayMiles = Math.round(route.oneWayMiles * 10) / 10;
      travel.durationMinutes = route.durationMinutes !== null ? Math.round(route.durationMinutes) : null;
      travel.verified = route.verified;
    }
  } else if (destination) {
    travel.destinationSource = destination.source;
  }

  const estimate = calculateEstimate(draft, buildEstimateContext(routed));
  if (estimate.status !== 'estimated') {
    return result(
      'mismatch',
      null,
      null,
      `Our server recalculation does not produce an instant price (${estimate.message ?? 'custom confirmation required'}). Review before confirming.`,
    );
  }

  const amount = selectInstantAmount(estimate);
  const range =
    estimate.low !== null && estimate.high !== null ? { low: estimate.low, high: estimate.high } : null;

  if (amount === null) {
    return result('unverifiable', null, range, 'Recalculation produced no instant price; review the request personally.');
  }
  if (clientPrice === null) {
    return result(
      'unverifiable',
      amount,
      range,
      `No price was submitted; our server calculation gives $${amount}. Review before confirming.`,
    );
  }

  const difference = Math.round((clientPrice - amount) * 100) / 100;
  if (Math.abs(difference) <= QUOTE_MATCH_TOLERANCE) {
    const travelCopy = travel.verified
      ? `live route ${travel.oneWayMiles ?? '—'} mi / ${travel.durationMinutes ?? '—'} min via ${travel.provider}`
      : `preliminary travel (${travel.destinationSource === 'address_geocode' ? 'geocoded address' : 'ZIP reference'}, ${travel.oneWayMiles ?? '—'} mi)`;
    return result('match', amount, range, `Verified: $${amount} matches our calculation (${travelCopy}).`);
  }

  const direction = difference > 0 ? 'higher than' : 'different from';
  return result(
    'mismatch',
    amount,
    range,
    `The submitted price $${clientPrice} is ${direction} our verified calculation $${amount}. Do not confirm without reviewing the scope.`,
  );
}

/** True when the flat fields describe a priced reservation request. */
export function isPricedReservation(fields: Record<string, string>): boolean {
  return fields.request_type === 'reservation_request' && (fields.quoted_price ?? '').trim() !== '';
}
