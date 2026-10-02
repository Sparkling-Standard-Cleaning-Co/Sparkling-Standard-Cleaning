// Server-side address resolution — SHARED by functions/api/geocode.ts (the
// browser-facing proxy) and the reservation verification in
// functions/api/lead.ts.
//
// The browser never sees a provider key. Only minimal fields are returned to
// callers: label, coordinates, source and (when available) ZIP/city/state.
//
// Exact-address rule: when the requested address carries a house number, a
// provider result is accepted ONLY when it actually contains that house
// number. MapMap's dataset does not cover every rural address (e.g. it knows
// "Haupert Lane" as a street but not "6360 Haupert Lane"), so a street-level
// or POI result must fall through to the free Census Geocoder rather than
// being silently treated as the precise destination.

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
  /** True when the result contains the requested house number (or none was requested). */
  precise: boolean;
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

/** The house number a query asks for, if any (e.g. "6360" from "6360 Haupert Ln"). */
export function queryHouseNumber(query: string): string | null {
  const match = query.trim().match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\b/i);
  return match ? (match[1] as string).toLowerCase() : null;
}

/** True when a result actually carries the requested house number. */
export function containsHouseNumber(label: string, requested: string | null): boolean {
  if (!requested) return true;
  return label.toLowerCase().includes(requested);
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
  const hasHouseNumber = typeof p.housenumber === 'string' && p.housenumber.trim().length > 0;
  const result: GeocodedAddress = { label, lat, lng, source, precise: hasHouseNumber };
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
    signal: AbortSignal.timeout(7000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/** U.S. Census Geocoder — free, keyless fallback (and the only server-side
 *  resolver when no MapMap key is configured). Returns exact house-number
 *  matches only. */
export async function censusResolve(query: string): Promise<GeocodedAddress | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    `?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as {
    result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x?: number; y?: number } }> };
  };
  const match = data.result?.addressMatches?.[0];
  const lat = Number(match?.coordinates?.y);
  const lng = Number(match?.coordinates?.x);
  if (!match?.matchedAddress || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const label = match.matchedAddress;
  const requested = queryHouseNumber(query);
  const result: GeocodedAddress = {
    label,
    lat,
    lng,
    source: 'census',
    // Census returns address-range matches; only a query WITH a house number
    // can count as an exact property.
    precise: requested !== null && containsHouseNumber(label, requested),
  };
  const zip = label.match(/,\s*(\d{5})(?:-\d{4})?\s*$/)?.[1];
  if (zip) result.zip = zip;
  // "6360 HAUPERT LN, MOLINO, FL, 32577" → city + state when present.
  const parts = label.split(',').map((part) => part.trim());
  if (parts.length >= 3) {
    const statePart = parts[parts.length - 2] ?? '';
    if (/^[A-Za-z]{2}$/.test(statePart)) result.state = statePart.toUpperCase();
    const cityPart = parts[parts.length - 3] ?? '';
    if (cityPart) result.city = cityPart;
  }
  return result;
}

/**
 * MapMap forward geocode, exact house-number matches only. Returns null when
 * unconfigured, unmatched, imprecise (street/POI when a house number was
 * requested) or failed — so the caller can fall through to Census.
 */
export async function mapMapResolve(env: GeocodeEnv, query: string): Promise<GeocodedAddress | null> {
  if (!mapMapKey(env)) return null;
  const { status, data } = await mapMapJson(env, `/geocode?q=${encodeURIComponent(query)}&limit=3&country=us`);
  if (status !== 200) return null;
  const requested = queryHouseNumber(query);
  const features = ((data as { features?: PhotonFeature[] })?.features ?? []);
  // Prefer an exact house-number feature; never accept a street/POI result for
  // a house-number query, and never mark a no-number query "precise".
  for (const feature of features) {
    const address = parsePhotonFeature(feature, 'mapmap');
    if (!address) continue;
    if (requested === null) return { ...address, precise: false };
    if (containsHouseNumber(address.label, requested)) return { ...address, precise: true };
  }
  return null;
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
 * Authoritative full-address resolution: an exact MapMap match when the
 * configured provider has one, otherwise the free Census Geocoder. Returns
 * null when neither can place the exact address (the customer's original
 * address is preserved and travel is confirmed manually).
 */
export async function resolveAddress(env: GeocodeEnv, query: string): Promise<GeocodedAddress | null> {
  const provider = await mapMapResolve(env, query).catch(() => null);
  if (provider) return provider;
  const first = await censusResolve(query).catch(() => null);
  if (first) return first;
  // Census occasionally misses or times out once; one immediate retry is cheap,
  // keyless and materially improves exact-address resolution.
  return censusResolve(query).catch(() => null);
}
