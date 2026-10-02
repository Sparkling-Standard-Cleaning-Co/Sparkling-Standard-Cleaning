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

/**
 * Verdict vocabulary:
 *  - verified     — price matches, travel is a live route to the geocoded
 *                   street address, and the quote's configuration version
 *                   matches the server's. The only verdict that may be
 *                   described as fully verified.
 *  - preliminary  — price matches, but at least one certainty is missing
 *                   (approximate/ZIP-centre travel, or unknown/stale config
 *                   version). Never a guaranteed travel-inclusive price.
 *  - mismatch     — the server calculation does not substantiate the price.
 *  - unverifiable — the request could not be checked at all.
 */
export type QuoteVerificationStatus = 'verified' | 'preliminary' | 'mismatch' | 'unverifiable';

export type QuoteConfigMatch = 'match' | 'mismatch' | 'unknown';

/**
 * What the server could establish about the customer-confirmed pin:
 *  - ok        — the submitted pin matches the server-geocoded destination;
 *  - adjusted  — the customer reported moving the pin (or it clearly moved);
 *  - divergent — the submitted pin is far from the server-geocoded address;
 *  - unknown   — no pin coordinates were submitted.
 * Only 'ok' can accompany a fully verified verdict: travel to a moved pin can
 * never be verified against the original geocoded street location.
 */
export type PinCheck = 'ok' | 'adjusted' | 'divergent' | 'unknown';

/** Distance above which a submitted pin is treated as divergent (metres). */
export const PIN_DIVERGENCE_METERS = 500;

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
  /** Whether the submitted quote was built on the current configuration. */
  configMatch: QuoteConfigMatch;
  clientReference: string | null;
  /** Format check only — the reference is display data, never authorization. */
  referenceValid: boolean;
  /** True only when travel was routed to a server-geocoded street address. */
  destinationPrecise: boolean;
  /** What the server could establish about the customer-confirmed pin. */
  pinCheck: PinCheck;
  /** Distance between the submitted pin and the geocoded address, metres. */
  pinDistanceMeters: number | null;
  travel: QuoteVerificationTravel;
  /** Plain-language verdict for the owner notification. */
  note: string;
  verifiedAt: string;
  validThrough: string;
}

/** Price agreement tolerance (USD): covers provider/rounding variance. */
export const QUOTE_MATCH_TOLERANCE = 10;

/** Display reference shape (see quote.ts createQuoteReference). */
const QUOTE_REFERENCE_PATTERN = /^SS-\d{8}-[0-9A-Z]{6}$/;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Parses the client-submitted pin, but only for divergence checking — never
 *  as a trusted calculation input. */
function parseSubmittedPin(fields: Record<string, string>): { lat: number; lng: number } | null {
  const lat = Number(fields.pin_latitude);
  const lng = Number(fields.pin_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

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
  const configMatch: QuoteConfigMatch =
    clientConfigVersion === null
      ? 'unknown'
      : clientConfigVersion === configVersion
        ? 'match'
        : 'mismatch';
  const clientReference = fields.quote_reference?.trim() || null;
  const referenceValid = clientReference !== null && QUOTE_REFERENCE_PATTERN.test(clientReference);
  const clientPrice = numberFrom(fields, 'quoted_price') ?? null;
  const travel: QuoteVerificationTravel = {
    method: 'zone',
    provider: 'none',
    oneWayMiles: null,
    durationMinutes: null,
    verified: false,
    destinationSource: 'none',
  };
  let pinCheck: PinCheck = 'unknown';
  let pinDistanceMeters: number | null = null;
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
    configMatch,
    clientReference,
    referenceValid,
    destinationPrecise: travel.destinationSource === 'address_geocode',
    pinCheck,
    pinDistanceMeters,
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

  // Pin integrity: a customer-moved pin is a real destination change. The
  // server still calculates from its OWN geocoded address (untrusted client
  // coordinates never drive the price), but it must never call travel to the
  // original address "verified" when the customer's confirmed pin sits
  // somewhere else — that would treat the original location and price as
  // verified for a different destination.
  const submittedPin = parseSubmittedPin(fields);
  if (destination && submittedPin) {
    pinDistanceMeters = Math.round(haversineMeters(submittedPin, destination));
  }
  const pinReportedAdjusted = fields.pin_adjusted === 'yes';
  if (pinReportedAdjusted) {
    pinCheck = 'adjusted';
  } else if (pinDistanceMeters !== null && pinDistanceMeters > PIN_DIVERGENCE_METERS) {
    pinCheck = 'divergent';
  } else if (submittedPin) {
    pinCheck = 'ok';
  } else {
    pinCheck = 'unknown';
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
  if (Math.abs(difference) > QUOTE_MATCH_TOLERANCE) {
    const direction = difference > 0 ? 'higher than' : 'different from';
    return result(
      'mismatch',
      amount,
      range,
      `The submitted price $${clientPrice} is ${direction} our verified calculation $${amount}. Do not confirm without reviewing the scope.`,
    );
  }

  // The price reproduces — but a reproduced number alone is not "verified".
  // Full verification requires live travel to the customer's geocoded street
  // address AND a quote built on the current configuration.
  const uncertainties: string[] = [];
  if (travel.verified && travel.destinationSource === 'address_geocode') {
    // Live route to the precise address: certainty about travel.
  } else if (travel.verified) {
    uncertainties.push('travel was routed to the ZIP-centre reference, not the street address');
  } else if (travel.method === 'straight_line_estimate') {
    uncertainties.push('travel is an approximate road-distance estimate, not a live route');
  } else {
    uncertainties.push('travel could not be measured (no live route)');
  }
  if (configMatch === 'unknown') {
    uncertainties.push('the submitted quote carried no configuration version');
  } else if (configMatch === 'mismatch') {
    uncertainties.push('the quote was built on a different configuration version');
  }
  if (pinCheck === 'adjusted') {
    uncertainties.push(
      'the customer moved the confirmed pin away from the geocoded address, so travel must be confirmed against the corrected point',
    );
  } else if (pinCheck === 'divergent') {
    uncertainties.push(
      `the submitted pin is about ${pinDistanceMeters} m from the server-geocoded address, so travel must be confirmed against the corrected point`,
    );
  }

  if (uncertainties.length === 0) {
    const travelCopy = `live route ${travel.oneWayMiles ?? '—'} mi / ${travel.durationMinutes ?? '—'} min via ${travel.provider}`;
    return result(
      'verified',
      amount,
      range,
      `Verified: $${amount} matches our calculation, travel is a ${travelCopy} to the confirmed address, and the configuration version matches.`,
    );
  }

  const travelSummary = travel.verified
    ? `live route ${travel.oneWayMiles ?? '—'} mi / ${travel.durationMinutes ?? '—'} min via ${travel.provider}`
    : travel.method === 'straight_line_estimate'
      ? `approximate ${travel.oneWayMiles ?? '—'} mi road-distance estimate`
      : 'zone-based travel';
  return result(
    'preliminary',
    amount,
    range,
    `Preliminary: $${amount} matches our calculation, but ${uncertainties.join('; ')} (${travelSummary}). Travel must be confirmed before treating this as travel-inclusive.`,
  );
}

/** True when the flat fields describe a priced reservation request. */
export function isPricedReservation(fields: Record<string, string>): boolean {
  return fields.request_type === 'reservation_request' && (fields.quoted_price ?? '').trim() !== '';
}
