// Customer location model — shared by the address finder UI, the estimate
// wizard summary and the reservation submission. Pure helpers only so it can
// be unit-tested with the Node test runner.

export type LocationSource = 'mapmap' | 'census' | 'manual';

/** A destination the customer explicitly confirmed (never a silent ZIP swap). */
export interface ConfirmedLocation {
  /** Full provider/Census label, e.g. "100 S BAYLEN ST, PENSACOLA, FL, 32502". */
  label: string;
  /** Street line as the customer entered or selected it. */
  street: string;
  /** Apartment / unit, collected separately. */
  unit?: string;
  lat: number;
  lng: number;
  /** 5-digit ZIP when the resolver or the customer supplied one. */
  zip?: string;
  city?: string;
  state?: string;
  source: LocationSource;
  /** True when the customer corrected the pin after resolution. */
  adjusted?: boolean;
  confirmedAt: string;
}

export interface GeocodeSuggestion {
  id: string;
  label: string;
  /**
   * Provider-embedded coordinates. MapMap suggestions are directly plottable,
   * so the client can confirm a destination without a retrieve round-trip.
   */
  lat?: number;
  lng?: number;
}

/** Rejects impossible coordinates and out-of-range values. */
export function isPlausibleCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

/** Cache/compare key for a confirmed location (4-decimal ≈ 11 m). */
export function locationKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Extracts a 5-digit ZIP from a geocoder label when present. */
export function zipFromLabel(label: string | undefined): string | null {
  if (!label) return null;
  const match = label.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? (match[1] as string) : null;
}

/**
 * Cuts the trailing city/state/ZIP out of a provider label so the display line
 * never repeats the region (labels like "100 S BAYLEN ST, PENSACOLA, FL, 32502").
 */
export function streetLineFromLabel(
  label: string,
  city?: string,
  state?: string,
  zip?: string,
): string {
  let line = label.trim();
  for (const part of [zip, state, city]) {
    if (!part) continue;
    const index = line.toLowerCase().lastIndexOf(part.toLowerCase());
    if (index > 0) line = line.slice(0, index);
  }
  return line.replace(/[,\s]+$/, '') || label;
}

/** One-line display form used in the confirmation card and order summary. */
export function formatLocationLine(location: ConfirmedLocation): string {
  const parts: string[] = [];
  const streetPart = [location.street || location.label, location.unit ? `Unit ${location.unit}` : '']
    .filter(Boolean)
    .join(', ');
  parts.push(streetPart);
  const region = [location.city, location.state].filter(Boolean).join(', ');
  const tail = [region, location.zip].filter(Boolean).join(' ');
  if (tail) parts.push(tail);
  return parts.join(' · ');
}

/** Query sent to /api/geocode resolve for manual entry. */
export function buildGeocodeQuery(street: string, unit: string | undefined, zip: string | undefined): string {
  const streetPart = [street.trim(), unit?.trim()].filter(Boolean).join(' ');
  return [streetPart, zip?.trim()].filter(Boolean).join(', ');
}
