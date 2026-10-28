/**
 * The identity of the scheduling context a temporary hold belongs to.
 *
 * A hold protects a specific time at a specific place for a specific duration.
 * It must NOT be tied to quote-reference or quote-amount values: quote
 * references rotate on a time boundary and prices can be recalculated without
 * invalidating a time the customer is actively holding. Tying the hold to those
 * values silently discards it and submits a request with no hold.
 */
export interface BookingHoldContext {
  durationMinutes: number;
  preferredDate: string;
  locationKey: string;
}

export function bookingHoldContextKey(input: BookingHoldContext): string {
  const { durationMinutes, preferredDate, locationKey: location } = input;
  if (
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ||
    !location
  ) {
    return '';
  }
  return `${durationMinutes}:${preferredDate}:${location}`;
}
