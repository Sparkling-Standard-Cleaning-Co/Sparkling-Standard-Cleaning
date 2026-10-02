// Instant quote — one deterministic offered price derived from the SAME
// calculation as the estimate range (no second pricing algorithm).
//
// Safety rules:
//  - Only an 'estimated' result can produce a price.
//  - The offered price is selected from the model's own values and can never
//    fall below expectedPrice × marginFloor, nor below the minimum job value.
//  - Rounding rounds UP to the configured step so the safeguard survives it.
//  - The quote carries the pricing configuration version and an internal
//    display-window marker. It is a PROPOSAL on a non-binding request: binding
//    offers stay disabled (pricing.instantQuote.binding === false) and every
//    reservation request is recalculated server-side in functions/api/lead.ts
//    before the owner sees it. A client-supplied price is never trusted.
//  - Customer-facing copy never states or implies a hold/expiry promise: the
//    server issues its own validity timestamp when it verifies a quote, and
//    the client-side `expiresAt` below is not presented to customers.

import { pricing } from '../../config/pricing.ts';
import type { EstimateResult } from './types.ts';

export type QuoteSelection = 'expected' | 'midpoint' | 'high';

export interface InstantQuote {
  /** Display reference the customer can quote on the phone. */
  reference: string;
  /** Offered price in USD (already rounded and margin-floored). */
  amount: number;
  laborHours: number;
  /**
   * Internal display-window marker only. NOT a customer promise or a held
   * offer; the server records its own validity when it verifies a quote.
   */
  expiresAt: string;
  selection: QuoteSelection;
  travelMode: EstimateResult['travel']['mode'];
  /** True only when travel came from a live provider route. */
  travelVerified: boolean;
  confidence: EstimateResult['confidence'];
  minimumApplied: boolean;
  /** Pricing configuration version the quote was built from. */
  configVersion: string;
}

const roundUpToStep = (value: number, step: number): number => Math.ceil(value / step) * step;

/**
 * Selects the single offered price from an estimate result. Returns null when
 * the result is not estimable (custom confirmation / invalid).
 */
export function selectInstantAmount(
  result: EstimateResult,
  selection: QuoteSelection = pricing.instantQuote.selection.value,
): number | null {
  if (result.status !== 'estimated') return null;
  if (result.expectedPrice === null || result.low === null || result.high === null) return null;

  const candidates: Record<QuoteSelection, number> = {
    expected: result.expectedPrice,
    midpoint: (result.low + result.high) / 2,
    high: result.high,
  };

  const marginFloor = result.expectedPrice * pricing.instantQuote.marginFloor.value;
  const minimum = pricing.minimumJob.value;
  const step = pricing.rounding.toNearest.value;

  // Never below the model price (margin safeguard) or the minimum job value.
  const floored = Math.max(candidates[selection], marginFloor, minimum);
  return roundUpToStep(floored, step);
}

/**
 * Builds the full instant quote, or null when the job needs confirmation.
 * `now` is injectable so expiry is deterministic in tests.
 */
export function buildInstantQuote(
  result: EstimateResult,
  input: { serviceType: string; zip: string },
  now: number = Date.now(),
): InstantQuote | null {
  const amount = selectInstantAmount(result);
  if (amount === null || result.laborHours === null) return null;

  return {
    reference: createQuoteReference({ amount, serviceType: input.serviceType, zip: input.zip, timestamp: now }),
    amount,
    laborHours: result.laborHours,
    expiresAt: new Date(now + pricing.instantQuote.validityHours.value * 3_600_000).toISOString(),
    selection: pricing.instantQuote.selection.value,
    travelMode: result.travel.mode,
    travelVerified: result.travel.verified,
    confidence: result.confidence,
    minimumApplied: result.minimumApplied,
    configVersion: pricing.instantQuote.configVersion.value,
  };
}

/**
 * Short display reference, e.g. "SS-20261001-K3F9QZ". Deterministic for the
 * same inputs and minute. Contains no customer information and is safe to read
 * aloud; it is not a signature and must not be used for authorization.
 */
export function createQuoteReference(input: {
  amount: number;
  serviceType: string;
  zip: string;
  timestamp: number;
}): string {
  const date = new Date(input.timestamp).toISOString().slice(0, 10).replaceAll('-', '');
  const seed = `${input.amount}|${input.serviceType}|${input.zip}|${Math.floor(input.timestamp / 60_000)}`;
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  const code = hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  return `SS-${date}-${code}`;
}

/** True when a quote built at `createdAt` is still valid at `now`. */
export function isQuoteValid(createdAt: number, now: number = Date.now()): boolean {
  return now - createdAt <= pricing.instantQuote.validityHours.value * 3_600_000;
}
