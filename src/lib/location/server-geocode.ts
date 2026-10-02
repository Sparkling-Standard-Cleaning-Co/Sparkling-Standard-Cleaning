// Server-side address resolution — SHARED by functions/api/geocode.ts (the
// browser-facing proxy) and the reservation verification in
// functions/api/lead.ts.
//
// The browser never sees a provider key. Only minimal fields are returned to
// callers: label, coordinates, source and (when available) ZIP/city/state.

export interface GeocodeEnv {
  /** Existing shared routing secret configured in Cloudflare (preferred). */
  ROUTES_API_KEY?: string;
  /** Optional alias so the service also works with a dedicated key. */
  MAPMAP_API_KEY?: string;
  MAPMAP_BASE?: string;
}

export interface GeocodedAddress {
  label: string;
  lat: number;
  lng: number;
  source: 'mapmap' | 'census';
  zip?: string;
  city?: string;
  state?: string;
}

/** One provider credential for all mapping functions — no duplicate secrets. */
export function mapMapKey(env: GeocodeEnv): string {
  return env.ROUTES_API_KEY?.trim() || env.MAPMAP_API_KEY?.trim() || '';
}

export function mapMapBase(env: GeocodeEnv): string {
  return (env.MAPMAP_BASE?.trim() || 'https://api.mapmap.ai').replace(/\/+$/, '');
}

interface PhotonProperties {
  label?: unknown;
  name?: unknown;
  street?: unknown;
  housenumber?: unknown;
  city?: unknown;
  state?: unknown;
  postcode?: unknown;
  id?: unknown;
  osm_type?: unknown;
  osm_id?: unknown;
}

export interface PhotonFeature {
  properties?: PhotonProperties;
  geometry?: { coordinates?: [number, number] };
}

export function featureLabel(feature: PhotonFeature): string | null {
  const p = feature.properties ?? {};
  const label =
    (typeof p.label === 'string' && p.label) ||
    [
      [p.housenumber, p.street].filter((part) => typeof part === 'string' && part).join(' '),
      p.name,
      p.city,
      p.state,
      p.postcode,
    ]
      .filter((part) => typeof part === 'string' && part.length > 0)
      .join(', ');
  return label || null;
}

export function featureId(feature: PhotonFeature): string | null {
  const p = feature.properties ?? {};
  if (typeof p.id === 'string') return p.id;
  if (p.osm_type !== undefined && p.osm_id !== undefined) return `${p.osm_type}${p.osm_id}`;
  return null;
}

const FIVE_DIGIT_ZIP = /\b(\d{5})(?:-\d{4})?\b/;

/** Maps a provider feature to the minimal address shape we return. */
export function parsePhotonFeature(feature: PhotonFeature, source: 'mapmap'): GeocodedAddress | null {
  const coords = feature.geometry?.coordinates;
  const label = featureLabel(feature);
  if (!label || !Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = feature.properties ?? {};
  const result: GeocodedAddress = { label, lat, lng, source };
  if (typeof p.postcode === 'string') {
    const zip = p.postcode.match(FIVE_DIGIT_ZIP)?.[1];
    if (zip) result.zip = zip;
  }
  if (typeof p.city === 'string' && p.city) result.city = p.city;
  if (typeof p.state === 'string' && p.state) result.state = p.state;
  return result;
}

async function mapMapJson(env: GeocodeEnv, path: string): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${mapMapBase(env)}${path}`, {
    headers: { Authorization: `Bearer ${mapMapKey(env)}` },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/** U.S. Census Geocoder — free, keyless fallback (and the only server-side
 *  resolver when no MapMap key is configured). */
export async function censusResolve(query: string): Promise<GeocodedAddress | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    `?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as {
    result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x?: number; y?: number } }> };
  };
  const match = data.result?.addressMatches?.[0];
  const lat = Number(match?.coordinates?.y);
  const lng = Number(match?.coordinates?.x);
  if (!match?.matchedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const result: GeocodedAddress = { label: match.matchedAddress, lat, lng, source: 'census' };
  const zip = match.matchedAddress.match(/,\s*(\d{5})(?:-\d{4})?\s*$/)?.[1];
  if (zip) result.zip = zip;
  return result;
}

/** MapMap forward geocode; null when unconfigured, unmatched or failed. */
export async function mapMapResolve(env: GeocodeEnv, query: string): Promise<GeocodedAddress | null> {
  if (!mapMapKey(env)) return null;
  const { status, data } = await mapMapJson(env, `/geocode?q=${encodeURIComponent(query)}&limit=1&country=us`);
  if (status !== 200) return null;
  const feature = ((data as { features?: PhotonFeature[] })?.features ?? [])[0];
  return feature ? parsePhotonFeature(feature, 'mapmap') : null;
}

/** MapMap suggestion retrieve (authoritative coordinates for a suggestion). */
export async function mapMapResolveId(env: GeocodeEnv, id: string): Promise<GeocodedAddress | null> {
  if (!mapMapKey(env)) return null;
  const { status, data } = await mapMapJson(env, `/geocode/retrieve?id=${encodeURIComponent(id)}`);
  if (status !== 200) return null;
  const feature = ((data as { features?: PhotonFeature[] })?.features ?? [])[0];
  return feature ? parsePhotonFeature(feature, 'mapmap') : null;
}

/**
 * Authoritative full-address resolution: MapMap when configured, Census
 * otherwise (and whenever MapMap has no match or errors).
 */
export async function resolveAddress(env: GeocodeEnv, query: string): Promise<GeocodedAddress | null> {
  const provider = await mapMapResolve(env, query).catch(() => null);
  if (provider) return provider;
  return censusResolve(query).catch(() => null);
}
