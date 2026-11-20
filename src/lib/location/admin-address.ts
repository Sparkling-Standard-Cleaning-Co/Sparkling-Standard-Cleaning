// Admin address suggestions and full place details.
//
// Uses the same private Google Maps Platform server key and Places API (New)
// integration as the public address engine. The key never reaches the browser.
// The public estimator workflow is unchanged.

import {
  googleAutocomplete,
  googlePlaceDetailsFull,
  googleMapsKey,
  type GeocodeEnv,
  type GooglePlaceDetailsFull,
  type GooglePrediction,
} from './server-geocode.ts';

export interface AddressBias {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

const BRANCH_BIAS: Record<string, AddressBias> = {
  branch_pensacola: { latitude: 30.4213, longitude: -87.2169, radiusMeters: 90000 },
  branch_tampa: { latitude: 27.9506, longitude: -82.4572, radiusMeters: 90000 },
};

export function branchAddressBias(branchId: string | null | undefined): AddressBias {
  return BRANCH_BIAS[String(branchId ?? '')] ?? BRANCH_BIAS.branch_pensacola!;
}

export interface AdminAddressSuggestion {
  id: string;
  label: string;
  mainText: string;
  secondaryText: string;
  kind: 'address' | 'street' | 'locality';
}

export async function adminAddressSuggestions(
  env: GeocodeEnv,
  input: { query: string; branchId?: string | null; sessionToken?: string },
): Promise<{ provider: 'google'; suggestions: AdminAddressSuggestion[] }> {
  if (!googleMapsKey(env)) throw new Error('google_places_not_configured');
  const bias = branchAddressBias(input.branchId);
  const rows = await googleAutocomplete(env, input.query, input.sessionToken, {
    latitude: bias.latitude,
    longitude: bias.longitude,
    radiusMeters: bias.radiusMeters,
    includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
  });
  return {
    provider: 'google',
    suggestions: rows.map((row: GooglePrediction) => ({
      id: row.id,
      label: row.label,
      mainText: row.mainText ?? row.label.split(',')[0]?.trim() ?? row.label,
      secondaryText: row.secondaryText ?? row.label.split(',').slice(1).join(',').trim(),
      kind: row.kind,
    })),
  };
}

export async function adminAddressDetails(
  env: GeocodeEnv,
  input: { placeId: string; sessionToken?: string },
): Promise<GooglePlaceDetailsFull | null> {
  if (!googleMapsKey(env)) throw new Error('google_places_not_configured');
  return googlePlaceDetailsFull(env, input.placeId, input.sessionToken);
}
