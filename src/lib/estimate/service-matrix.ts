// Service/frequency compatibility matrix (owner-directed estimator audit,
// 2026-10-23). The selected cleaning service determines which questions are
// relevant — the wizard hides inapplicable controls, the shared validator
// rejects invalid combinations, and the server enforces the same matrix
// through the identical validation module. Nothing is patched cosmetically:
// an invalid service+frequency pair can never produce a quote.
//
// Matrix rationale (grounded in the company's actual offerings):
//  - standard (Residential house cleaning): one-time OR a new recurring
//    arrangement (weekly / biweekly / monthly, each with the required
//    first-visit Deep Cleaning and distinct ongoing pricing).
//  - deep (Deep Cleaning): a one-time reset. Recurring maintenance is the
//    Recurring Residential service; returning clients may schedule another
//    deep clean when needed, but there is no weekly/monthly deep plan.
//  - move_in_out: a move is a one-time event by definition.
//  - str_turnover: an individual turnover request (per-turnover). Ongoing
//    rental relationships are handled through the STR request form, not by
//    attaching a maintenance rhythm to one turnover.

import type { Frequency, ServiceType } from './types.ts';

/** Frequencies each service genuinely supports — the single source of truth. */
export const SERVICE_FREQUENCIES: Readonly<Record<ServiceType, readonly Frequency[]>> = {
  standard: ['one_time', 'weekly', 'biweekly', 'monthly'],
  deep: ['one_time'],
  move_in_out: ['one_time'],
  str_turnover: ['one_time'],
};

/** Services whose product is a one-time appointment (no rhythm question). */
export const ONE_TIME_SERVICES: readonly ServiceType[] = ['deep', 'move_in_out', 'str_turnover'];

/** True when the service/frequency combination is a real, bookable product. */
export function serviceSupportsFrequency(service: ServiceType, frequency: Frequency): boolean {
  const allowed = SERVICE_FREQUENCIES[service];
  return Array.isArray(allowed) && allowed.includes(frequency);
}

/**
 * Whether the wizard should SHOW the frequency question for this service.
 * Only Residential house cleaning offers a rhythm; one-time services never
 * see the question and always submit `one_time`.
 */
export function serviceAsksFrequency(service: ServiceType): boolean {
  return SERVICE_FREQUENCIES[service].length > 1;
}
