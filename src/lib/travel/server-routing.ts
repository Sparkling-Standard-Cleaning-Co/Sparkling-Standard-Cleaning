// Server-side routing resolution — SHARED by functions/api/travel.ts and the
// reservation verification in functions/api/lead.ts.
//
// Rules:
//  - The private operating origin (TRAVEL_ORIGIN) is read from the function
//    environment and is never included in a response, log or error message.
//  - Provider API keys never leave the server.
//  - Every provider failure falls back to a labeled straight-line estimate; a
//    routing failure must never break an estimate or discard a customer lead.

import { travelConfig } from '../../config/travel.ts';

export interface RoutingEnv {
  TRAVEL_ORIGIN?: string;
  ROUTES_PROVIDER?: string;
  ROUTES_API_KEY?: string;
  /** Optional MapMap gateway override (defaults to https://api.mapmap.ai). */
  MAPMAP_BASE?: string;
  EIA_API_KEY?: string;
  REFERENCE_GAS_PRICE?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export function parseLatLng(value: string | undefined | null): LatLng | null {
  if (!value) return null;
  const [lat, lng] = value.split(',').map((part) => Number(part.trim()));
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function straightLineMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  // 1.18 approximates real road distance on the Gulf Coast grid.
  return 2 * 3958.8 * Math.asin(Math.sqrt(h)) * 1.18;
}

export interface ServerRoute {
  oneWayMiles: number;
  durationMinutes: number | null;
  provider: string;
  method: 'route' | 'straight_line_estimate';
  /** True when a live routing provider answered (not a straight-line stand-in). */
  verified: boolean;
}

/**
 * Resolves a one-way driving route between two server-side points. Provider
 * failures (including quota refusals) fall back to a straight-line estimate
 * labeled `straight_line_estimate`; they are never reported as routes.
 */
export async function resolveRoute(
  env: RoutingEnv,
  origin: LatLng,
  destination: LatLng,
): Promise<ServerRoute> {
  const apiKey = env.ROUTES_API_KEY?.trim();
  // Paid providers are explicitly disabled for this deployment: only MapMap
  // (free tier, refuses at quota) may be activated, and only when its key is
  // present. An accidental ROUTES_PROVIDER=google|mapbox (or any other value)
  // is ignored and degrades to the labeled straight-line fallback — it can
  // never reach a paid endpoint.
  const requested = env.ROUTES_PROVIDER?.trim().toLowerCase();
  const provider = requested === 'mapmap' ? 'mapmap' : requested ? '' : apiKey ? 'mapmap' : '';

  if (provider === 'mapmap' && apiKey) {
    try {
      // MapMap hosted gateway — OSRM-compatible response (distance metres,
      // duration seconds). Free tier: requests are refused at quota, so
      // overage charges cannot occur.
      const base = env.MAPMAP_BASE?.trim() || 'https://api.mapmap.ai';
      const url =
        `${base}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
        `?overview=false`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      const data = (await response.json().catch(() => ({}))) as {
        routes?: Array<{ distance?: number; duration?: number }>;
      };
      const route = data.routes?.[0];
      const meters = route?.distance;
      const seconds = typeof route?.duration === 'number' && route.duration > 0 ? route.duration : null;
      if (response.ok && typeof meters === 'number' && meters > 0) {
        return {
          oneWayMiles: meters / 1609.344,
          durationMinutes: seconds !== null ? seconds / 60 : null,
          provider,
          method: 'route',
          verified: true,
        };
      }
    } catch {
      // Fall through to the straight-line estimate.
    }
  }

  return {
    oneWayMiles: straightLineMiles(origin, destination),
    durationMinutes: null,
    provider: 'straight_line',
    method: 'straight_line_estimate',
    verified: false,
  };
}

export interface GasPriceResult {
  gasPrice: number | null;
  gasPriceSource: 'eia_live' | 'configured_reference' | 'none';
}

/** The configured reference price, defaulting to the shared travel config. */
export function configuredReferenceGasPrice(env: RoutingEnv): number {
  return Number(env.REFERENCE_GAS_PRICE ?? travelConfig.fallbackGasPrice) || travelConfig.fallbackGasPrice;
}

/** Weekly Gulf Coast gasoline reference; never fails the estimate. */
export async function gulfCoastGasPrice(
  apiKey: string | undefined,
  reference: number,
): Promise<GasPriceResult> {
  if (!apiKey) return { gasPrice: reference, gasPriceSource: 'configured_reference' };
  try {
    const url =
      'https://api.eia.gov/v2/petroleum/pri/gnd/data/?frequency=weekly&data[0]=value' +
      `&facets[series][]=EMM_EPMR_PTE_R30_DPG&sort[0][column]=period&sort[0][direction]=desc&length=1&api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`EIA HTTP ${response.status}`);
    const data = (await response.json()) as {
      response?: { data?: Array<{ value?: number | string }> };
    };
    const value = Number(data.response?.data?.[0]?.value);
    if (!Number.isFinite(value) || value <= 0) throw new Error('no price');
    return { gasPrice: value, gasPriceSource: 'eia_live' };
  } catch {
    // Never fail the customer quote because the fuel feed is down.
    return { gasPrice: reference, gasPriceSource: 'configured_reference' };
  }
}
