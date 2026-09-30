// Routing provider abstraction — the estimator logic is never coupled to one
// routing API. Providers are used server-side only (functions/api/travel.ts);
// API keys must never reach the browser.

export interface RouteResult {
  /** Driving distance in miles (route distance, not straight-line). */
  oneWayMiles: number;
  provider: string;
}

export interface RoutingProvider {
  readonly id: string;
  /** Returns route distance in miles between two "lat,lng" points. */
  oneWayMiles(origin: string, destination: string, signal?: AbortSignal): Promise<RouteResult>;
}

export class RoutingProviderError extends Error {
  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.name = 'RoutingProviderError';
  }
}

export interface RoutingProviderConfig {
  provider?: string;
  apiKey?: string;
  /** Server-side fetch timeout in milliseconds. */
  timeoutMs?: number;
}

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving';

async function fetchJson(url: string, init: RequestInit, provider: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new RoutingProviderError(provider, `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof RoutingProviderError) throw error;
    throw new RoutingProviderError(provider, error instanceof Error ? error.message : 'request failed');
  } finally {
    clearTimeout(timeout);
  }
}

function parseLatLng(value: string): { lat: number; lng: number } {
  const parts = value.split(',').map((part) => Number(part.trim()));
  const lat = parts[0];
  const lng = parts[1];
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new RoutingProviderError('config', `invalid "lat,lng" value: ${value}`);
  }
  return { lat, lng };
}

export class GoogleRoutesProvider implements RoutingProvider {
  readonly id = 'google_routes';
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs = 5000) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async oneWayMiles(origin: string, destination: string): Promise<RouteResult> {
    const from = parseLatLng(origin);
    const to = parseLatLng(destination);
    const body = JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'IMPERIAL',
    });
    const data = (await fetchJson(
      GOOGLE_ROUTES_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters',
        },
        body,
      },
      this.id,
      this.timeoutMs,
    )) as { routes?: Array<{ distanceMeters?: number }> };
    const meters = data.routes?.[0]?.distanceMeters;
    if (typeof meters !== 'number' || meters <= 0) {
      throw new RoutingProviderError(this.id, 'no route returned');
    }
    return { oneWayMiles: meters / 1609.344, provider: this.id };
  }
}

export class MapboxProvider implements RoutingProvider {
  readonly id = 'mapbox';
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs = 5000) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async oneWayMiles(origin: string, destination: string): Promise<RouteResult> {
    const from = parseLatLng(origin);
    const to = parseLatLng(destination);
    const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${MAPBOX_DIRECTIONS_URL}/${coordinates}?access_token=${encodeURIComponent(this.apiKey)}&overview=false`;
    const data = (await fetchJson(url, { method: 'GET' }, this.id, this.timeoutMs)) as {
      routes?: Array<{ distance?: number }>;
    };
    const meters = data.routes?.[0]?.distance;
    if (typeof meters !== 'number' || meters <= 0) {
      throw new RoutingProviderError(this.id, 'no route returned');
    }
    return { oneWayMiles: meters / 1609.344, provider: this.id };
  }
}
