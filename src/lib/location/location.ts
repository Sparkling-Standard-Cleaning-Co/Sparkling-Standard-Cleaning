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
   * Provider document kind: 'address' has a house number, while 'street',
   * 'poi', 'locality' and 'postcode' are not precise destinations.
   */
  kind?: string;
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

/** Query sent to /api/geocode for exact-address resolution. */
export function buildGeocodeQuery(
  street: string,
  unit: string | undefined,
  city: string | undefined,
  state: string | undefined,
  zip: string | undefined,
): string {
  const streetPart = [street.trim(), unit?.trim()].filter(Boolean).join(' ');
  const region = [city?.trim(), state?.trim()].filter(Boolean).join(', ');
  return [streetPart, region, zip?.trim()].filter(Boolean).join(', ');
}

/** The house number a street line starts with, if any. */
export function houseNumberFromStreet(street: string): string | null {
  const match = street.trim().match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\b/i);
  return match ? (match[1] as string).toLowerCase() : null;
}

/** True when a provider label actually contains the requested house number. */
export function labelHasHouseNumber(label: string, houseNumber: string | null): boolean {
  if (!houseNumber) return true;
  return label.toLowerCase().includes(houseNumber);
}

/** US states + DC for the address form (Florida first — the home market). */
export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'FL', name: 'Florida' },
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const;
