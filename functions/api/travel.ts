// POST /api/travel — serverless travel lookup (Cloudflare Pages Functions).
//
// Returns a preliminary ONE-WAY route distance for a ZIP code plus the best
// available Gulf Coast gasoline reference price. Routing providers are called
// server-side so API keys never reach the browser.
//
// Behavior:
//  - TRAVEL_ORIGIN must be configured; otherwise 503 (client stays in the
//    offline zone mode — the estimate keeps working either way).
//  - With a routing provider configured, real route distance is used.
//    Without one, straight-line distance × 1.18 approximates the road route
//    and is labeled as such via `method`.
//  - Gas price failure never fails the request: the configured reference
//    price is returned with source 'configured_reference'.
//
// Responses:
//   200 { oneWayMiles, gasPrice, gasPriceSource, provider, method, zone? }
//   400 { ok: false, error: 'invalid_request' | 'zip_not_referenced' }
//   503 { ok: false, error: 'origin_not_configured' }

interface Env {
  TRAVEL_ORIGIN?: string;
  ROUTES_PROVIDER?: string;
  ROUTES_API_KEY?: string;
  EIA_API_KEY?: string;
  REFERENCE_GAS_PRICE?: string;
  TRAVEL_CACHE_SECONDS?: string;
}

// Approximate ZIP centroids — mirrors src/config/geography.ts. Kept local so
// the function bundle has no build-time dependency on the Astro src tree.
const ZIP_CENTROIDS: Record<string, { lat: number; lng: number; zone: string }> = {
  '32501': { lat: 30.42, lng: -87.22, zone: 'core' },
  '32502': { lat: 30.41, lng: -87.23, zone: 'core' },
  '32503': { lat: 30.45, lng: -87.21, zone: 'core' },
  '32504': { lat: 30.48, lng: -87.19, zone: 'core' },
  '32505': { lat: 30.44, lng: -87.26, zone: 'core' },
  '32506': { lat: 30.4, lng: -87.31, zone: 'core' },
  '32507': { lat: 30.36, lng: -87.35, zone: 'core' },
  '32508': { lat: 30.35, lng: -87.28, zone: 'core' },
  '32511': { lat: 30.42, lng: -87.22, zone: 'core' },
  '32514': { lat: 30.53, lng: -87.22, zone: 'core' },
  '32526': { lat: 30.49, lng: -87.32, zone: 'core' },
  '32533': { lat: 30.61, lng: -87.34, zone: 'core' },
  '32530': { lat: 30.61, lng: -87.03, zone: 'surrounding' },
  '32561': { lat: 30.35, lng: -87.16, zone: 'surrounding' },
  '32563': { lat: 30.39, lng: -87.07, zone: 'surrounding' },
  '32565': { lat: 30.95, lng: -87.15, zone: 'surrounding' },
  '32566': { lat: 30.42, lng: -86.89, zone: 'surrounding' },
  '32570': { lat: 30.66, lng: -87.05, zone: 'surrounding' },
  '32571': { lat: 30.62, lng: -87.16, zone: 'surrounding' },
  '32577': { lat: 30.72, lng: -87.31, zone: 'surrounding' },
  '32583': { lat: 30.58, lng: -86.98, zone: 'surrounding' },
  '36426': { lat: 31.1, lng: -87.07, zone: 'extended' },
  '36502': { lat: 31.02, lng: -87.49, zone: 'extended' },
  '36507': { lat: 30.88, lng: -87.77, zone: 'extended' },
  '36526': { lat: 30.6, lng: -87.9, zone: 'extended' },
  '36527': { lat: 30.67, lng: -87.91, zone: 'extended' },
  '36530': { lat: 30.42, lng: -87.6, zone: 'extended' },
  '36532': { lat: 30.52, lng: -87.9, zone: 'extended' },
  '36535': { lat: 30.41, lng: -87.68, zone: 'extended' },
  '36542': { lat: 30.25, lng: -87.7, zone: 'extended' },
  '36551': { lat: 30.62, lng: -87.75, zone: 'extended' },
  '36561': { lat: 30.29, lng: -87.57, zone: 'extended' },
  '36567': { lat: 30.55, lng: -87.71, zone: 'extended' },
  '36580': { lat: 30.49, lng: -87.7, zone: 'extended' },
};

// Per-isolate cache (Workers instances are short-lived; this is opportunistic).
const routeCache = new Map<string, { expires: number; value: RoutePayload }>();

interface RoutePayload {
  oneWayMiles: number;
  gasPrice: number | null;
  gasPriceSource: 'eia_live' | 'configured_reference' | 'none';
  provider: string;
  method: 'route' | 'straight_line_estimate';
  zone: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function parseLatLng(value: string | undefined): { lat: number; lng: number } | null {
  if (!value) return null;
  const [lat, lng] = value.split(',').map((part) => Number(part.trim()));
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function straightLineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  // 1.18 approximates real road distance on the Gulf Coast grid.
  return 2 * 3958.8 * Math.asin(Math.sqrt(h)) * 1.18;
}

async function routeDistance(
  env: Env,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<{ oneWayMiles: number; provider: string; method: RoutePayload['method'] }> {
  const provider = env.ROUTES_PROVIDER?.trim().toLowerCase();
  const apiKey = env.ROUTES_API_KEY?.trim();

  if (provider && apiKey) {
    try {
      if (provider === 'google' || provider === 'google_routes') {
        const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.distanceMeters',
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
            destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_UNAWARE',
            units: 'IMPERIAL',
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          routes?: Array<{ distanceMeters?: number }>;
        };
        const meters = data.routes?.[0]?.distanceMeters;
        if (response.ok && typeof meters === 'number' && meters > 0) {
          return { oneWayMiles: meters / 1609.344, provider, method: 'route' };
        }
      } else if (provider === 'mapbox') {
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
          `?access_token=${encodeURIComponent(apiKey)}&overview=false`;
        const response = await fetch(url);
        const data = (await response.json().catch(() => ({}))) as {
          routes?: Array<{ distance?: number }>;
        };
        const meters = data.routes?.[0]?.distance;
        if (response.ok && typeof meters === 'number' && meters > 0) {
          return { oneWayMiles: meters / 1609.344, provider, method: 'route' };
        }
      }
    } catch {
      // Fall through to the straight-line estimate.
    }
  }

  return {
    oneWayMiles: straightLineMiles(origin, destination),
    provider: 'straight_line',
    method: 'straight_line_estimate',
  };
}

async function gulfCoastGasPrice(
  apiKey: string | undefined,
  reference: number,
): Promise<{ gasPrice: number | null; gasPriceSource: RoutePayload['gasPriceSource'] }> {
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

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  const origin = parseLatLng(env.TRAVEL_ORIGIN);
  if (!origin) {
    return json({ ok: false, error: 'origin_not_configured' }, 503);
  }

  let zip = '';
  try {
    const body = (await request.json()) as { zip?: unknown };
    zip = typeof body.zip === 'string' ? body.zip.trim().slice(0, 10) : '';
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const match = zip.match(/^(\d{5})(?:-\d{4})?$/);
  if (!match) return json({ ok: false, error: 'invalid_request' }, 400);
  const normalized = match[1] as string;

  const destination = ZIP_CENTROIDS[normalized];
  if (!destination) {
    return json({ ok: false, error: 'zip_not_referenced' }, 400);
  }

  const cacheSeconds = Math.max(60, Number(env.TRAVEL_CACHE_SECONDS ?? 21600) || 21600);
  const cached = routeCache.get(normalized);
  if (cached && cached.expires > Date.now()) {
    return json(cached.value);
  }

  const reference = Number(env.REFERENCE_GAS_PRICE ?? 3.1) || 3.1;
  const distance = await routeDistance(env, origin, { lat: destination.lat, lng: destination.lng });
  const gas = await gulfCoastGasPrice(env.EIA_API_KEY?.trim(), reference);

  const payload: RoutePayload = {
    oneWayMiles: Math.round(distance.oneWayMiles * 10) / 10,
    gasPrice: gas.gasPrice,
    gasPriceSource: gas.gasPriceSource,
    provider: distance.provider,
    method: distance.method,
    zone: destination.zone,
  };

  routeCache.set(normalized, { expires: Date.now() + cacheSeconds * 1000, value: payload });
  return json(payload);
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
