// POST /api/travel — serverless travel lookup (Cloudflare Pages Functions).
//
// Accepts either a ZIP code (preliminary ZIP-centroid destination) or
// confirmed destination coordinates (the customer-confirmed map pin). Returns
// a one-way route distance + driving duration from the private operating
// origin plus the best available Gulf Coast gasoline reference price.
//
// Routing providers are called server-side so the origin and API keys never
// reach the browser.
//
// Behavior:
//  - TRAVEL_ORIGIN must be configured; otherwise 503 (client stays in the
//    offline zone mode — the estimate keeps working either way).
//  - With a routing provider configured, real route distance and duration are
//    used (`method: 'route'`, `verified: true`).
//  - No provider / provider failure: straight-line distance × 1.18 approximates
//    the road route and is labeled `straight_line_estimate`.
//  - Gas price failure never fails the request: the configured/reference
//    price is returned with source 'configured_reference'.
//
// Responses:
//   200 { oneWayMiles, durationMinutes, gasPrice, gasPriceSource, provider,
//         method, verified, zone, method }
//   400 { ok: false, error: 'invalid_request' | 'zip_not_referenced' }
//   503 { ok: false, error: 'origin_not_configured' }

interface Env {
  TRAVEL_ORIGIN?: string;
  ROUTES_PROVIDER?: string;
  ROUTES_API_KEY?: string;
  /** Optional MapMap gateway override (defaults to https://api.mapmap.ai). */
  MAPMAP_BASE?: string;
  EIA_API_KEY?: string;
  REFERENCE_GAS_PRICE?: string;
  TRAVEL_CACHE_SECONDS?: string;
}

import { zoneForZip } from '../../src/config/geography.ts';
import { zipReference } from '../../src/config/geography.ts';
import { travelConfig } from '../../src/config/travel.ts';
import {
  configuredReferenceGasPrice,
  gulfCoastGasPrice,
  parseLatLng,
  resolveRoute,
  type LatLng,
} from '../../src/lib/travel/server-routing.ts';

// ZIP reference data lives in src/config/geography.ts (shared single source).
// It is preliminary location data, never treated as a precise customer address.

// Per-isolate cache (Workers instances are short-lived; this is opportunistic).
const routeCache = new Map<string, { expires: number; value: RoutePayload }>();

interface RoutePayload {
  oneWayMiles: number;
  durationMinutes: number | null;
  gasPrice: number | null;
  gasPriceSource: 'eia_live' | 'configured_reference' | 'none';
  provider: string;
  method: 'route' | 'straight_line_estimate';
  verified: boolean;
  zone: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function validCoordinates(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  const origin = parseLatLng(env.TRAVEL_ORIGIN);
  if (!origin) {
    return json({ ok: false, error: 'origin_not_configured' }, 503);
  }

  let zip = '';
  let coordinates: LatLng | null = null;
  try {
    const body = (await request.json()) as { zip?: unknown; lat?: unknown; lng?: unknown };
    zip = typeof body.zip === 'string' ? body.zip.trim().slice(0, 10) : '';
    coordinates = validCoordinates(body.lat, body.lng);
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  let normalized = '';
  if (zip) {
    const match = zip.match(/^(\d{5})(?:-\d{4})?$/);
    if (!match) return json({ ok: false, error: 'invalid_request' }, 400);
    normalized = match[1] as string;
  }

  let destination: LatLng | null = coordinates;
  let zone = coordinates ? zoneForZip(normalized || null) : 'unknown';

  if (!destination) {
    const reference = normalized ? zipReference[normalized] : null;
    if (!reference) {
      if (normalized) return json({ ok: false, error: 'zip_not_referenced' }, 400);
      return json({ ok: false, error: 'invalid_request' }, 400);
    }
    destination = { lat: reference.lat, lng: reference.lng };
    zone = reference.zone;
  }

  const cacheKey = coordinates
    ? `geo:${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}:${normalized}`
    : `zip:${normalized}`;

  const cacheSeconds = Math.max(
    60,
    Number(env.TRAVEL_CACHE_SECONDS ?? travelConfig.cacheSeconds) || travelConfig.cacheSeconds,
  );
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return json(cached.value);
  }

  const reference = configuredReferenceGasPrice(env);
  const distance = await resolveRoute(env, origin, destination);
  const gas = await gulfCoastGasPrice(env.EIA_API_KEY?.trim(), reference);

  const payload: RoutePayload = {
    oneWayMiles: Math.round(distance.oneWayMiles * 10) / 10,
    durationMinutes: distance.durationMinutes !== null ? Math.round(distance.durationMinutes) : null,
    gasPrice: gas.gasPrice,
    gasPriceSource: gas.gasPriceSource,
    provider: distance.provider,
    method: distance.method,
    verified: distance.verified,
    zone,
  };

  routeCache.set(cacheKey, { expires: Date.now() + cacheSeconds * 1000, value: payload });
  return json(payload);
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
