// POST /api/geocode — server-side address geocoding proxy (Cloudflare Pages Functions).
//
// Actions:
//   { action: 'suggest', query }   → address suggestions (MapMap /geocode/suggest)
//   { action: 'resolve', query }   → authoritative coordinates for a full address
//                                    (MapMap /geocode when configured, else Census)
//   { action: 'resolve-id', id }   → authoritative coordinates for a suggestion id
//                                    (MapMap /geocode/retrieve passthrough)
//
// Rules:
//  - Provider keys live only in the function environment (ROUTES_API_KEY or the
//    MAPMAP_API_KEY alias). They are never returned to the browser.
//  - The private operating origin is NEVER read, returned or logged here.
//  - Requests are throttled per client IP and capped per isolate-days as a
//    circuit breaker; the MapMap free tier cannot bill, and Census is free.
//  - Only minimal fields are returned to the browser (label, coords, id, and
//    ZIP/city/state when the provider supplies them).
//
// Responses: 200 { ok: true, ... } | 400 | 404 | 405 | 429 | 502 | 503

import {
  featureId,
  featureLabel,
  mapMapKey,
  mapMapResolveId,
  resolveAddress,
  reverseGeocode,
  type GeocodeEnv,
  type PhotonFeature,
} from '../../src/lib/location/server-geocode.ts';
import {
  rankSuggestions,
  suggestQueryVariants,
  type RawSuggestion,
} from '../../src/lib/location/suggestion-ranking.ts';

interface Env extends GeocodeEnv {}

const MAX_QUERY = 120;
const MIN_QUERY = 3;
const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = 20;
// Provider address suggestions are unbilled up to 5,000/day; this isolate-level
// circuit breaker stays well inside that and protects against abuse.
const DAILY_CAP = 2000;

const hits = new Map<string, { count: number; reset: number }>();
let dailyCount = 0;
let dailyReset = startOfDay();

function startOfDay(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}

/** Simple per-isolate throttle + daily circuit breaker. Fails open only to 429. */
function throttled(request: Request): boolean {
  const now = Date.now();
  if (now > dailyReset) {
    dailyCount = 0;
    dailyReset = startOfDay();
  }
  if (dailyCount >= DAILY_CAP) return true;

  const ip = clientIp(request);
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
  } else {
    entry.count += 1;
    if (entry.count > PER_IP_PER_MINUTE) return true;
  }
  dailyCount += 1;
  return false;
}

function cleanQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_QUERY);
  return trimmed.length >= MIN_QUERY ? trimmed : null;
}

interface Suggestion {
  id: string;
  label: string;
  /** Provider document kind: 'address', 'street', 'poi', 'locality', … */
  kind?: string;
  /** Provider-embedded coordinates (MapMap suggestions are directly plottable). */
  lat?: number;
  lng?: number;
}

/**
 * Public service-area centre used only to BIAS suggestion ordering
 * (lon,lat). It is a coarse Pensacola city-centre point — never the private
 * operating origin — and bias only reorders, it never excludes.
 */
export const SUGGEST_BIAS = '-87.2169,30.4213';

/**
 * /geocode/suggest returns `{ suggestions: [{ id, name, context, kind, lat, lon }] }`
 * (verified against the provider's OpenAPI schema). Photon-style `features`
 * payloads from other conforming gateways are still accepted defensively.
 */
function parseSuggestPayload(data: unknown): RawSuggestion[] {
  const list: RawSuggestion[] = [];
  const rows = (data as { suggestions?: unknown })?.suggestions;
  if (Array.isArray(rows)) {
    for (const row of rows as Array<Record<string, unknown>>) {
      const id = typeof row.id === 'string' ? row.id : '';
      const name = typeof row.name === 'string' ? row.name : '';
      const context = typeof row.context === 'string' ? row.context : '';
      const kind = typeof row.kind === 'string' ? row.kind : undefined;
      const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : undefined;
      const lng = typeof row.lon === 'number' && Number.isFinite(row.lon) ? row.lon : undefined;
      if (!id || !(name || context)) continue;
      list.push({
        id,
        name,
        context,
        ...(kind ? { kind } : {}),
        ...(lat !== undefined ? { lat } : {}),
        ...(lng !== undefined ? { lng } : {}),
      });
    }
    return list;
  }
  const features = (data as { features?: PhotonFeature[] })?.features;
  for (const feature of features ?? []) {
    const label = featureLabel(feature);
    const id = featureId(feature);
    if (label && id) list.push({ id, name: label, context: '' });
  }
  return list;
}

const PROVIDER_LIMIT = 10;
const DISPLAY_LIMIT = 6;

async function providerSuggest(env: Env, query: string): Promise<RawSuggestion[]> {
  const response = await fetch(
    `${(env.MAPMAP_BASE?.trim() || 'https://api.mapmap.ai').replace(/\/+$/, '')}` +
      `/geocode/suggest?q=${encodeURIComponent(query)}&limit=${PROVIDER_LIMIT}` +
      `&bias=${encodeURIComponent(SUGGEST_BIAS)}&lang=en`,
    { headers: { Authorization: `Bearer ${mapMapKey(env)}` }, signal: AbortSignal.timeout(7000) },
  );
  if (response.status !== 200) throw new Error(`provider HTTP ${response.status}`);
  const data = await response.json().catch(() => ({}));
  return parseSuggestPayload(data);
}

interface SuggestParts {
  query: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Geographically intelligent suggestions: state is a hard filter, ZIP is a
 * hard filter when present, street names must match (with road-name
 * variations), and exact house numbers rank first. The primary provider call
 * is followed by at most `MAX_SUGGEST_VARIANTS` alternates, and only while no
 * usable rows have been found — working addresses normally cost one call.
 */
async function suggestionsForAddress(env: Env, parts: SuggestParts): Promise<{
  suggestions: Suggestion[];
  needsLocation: boolean;
}> {
  const providerQuery = [parts.street, parts.city].filter(Boolean).join(', ') || parts.query;
  const location = { street: parts.street, city: parts.city, state: parts.state, zip: parts.zip };
  const houseNumber = parts.street.trim().match(/^(\d+[a-z]?)\b/i)?.[1]?.toLowerCase() ?? null;

  let rows = await providerSuggest(env, providerQuery);
  let result = rankSuggestions(rows, location, houseNumber);

  // Alternate query forms handle road-name variations (Hwy/SR/state
  // directions), street-suffix spelling (Ln/Lane, St/Street, Rd/Road …) and
  // a house-numberless street-level fallback for addresses the provider only
  // knows as streets.
  if (result.ranked.length === 0) {
    for (const variant of suggestQueryVariants(parts.street, parts.city || undefined)) {
      const variantRows = await providerSuggest(env, variant);
      if (variantRows.length > 0) {
        rows = variantRows;
        result = rankSuggestions(rows, location, houseNumber);
        if (result.ranked.length > 0) break;
      }
    }
  }

  const suggestions: Suggestion[] = result.ranked.slice(0, DISPLAY_LIMIT).map((row) => ({
    id: row.id,
    label: row.label,
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.lat !== undefined ? { lat: row.lat } : {}),
    ...(row.lng !== undefined ? { lng: row.lng } : {}),
  }));

  return { suggestions, needsLocation: result.needsLocation };
}

function cleanPart(value: unknown, max = 80): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  if (throttled(request)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  let payload: { action?: unknown; query?: unknown; id?: unknown; street?: unknown; city?: unknown; state?: unknown; zip?: unknown; lat?: unknown; lng?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const action = typeof payload.action === 'string' ? payload.action : '';
  const configured = Boolean(mapMapKey(env));

  try {
    if (action === 'suggest') {
      const query = cleanQuery(payload.query);
      const parts: SuggestParts = {
        query: query ?? '',
        street: cleanPart(payload.street),
        city: cleanPart(payload.city, 60),
        state: cleanPart(payload.state, 2).toUpperCase(),
        zip: cleanPart(payload.zip, 10),
      };
      // Legacy callers may send only `query`; keep that working.
      if (!parts.query && !parts.street) return json({ ok: false, error: 'invalid_request' }, 400);
      if (!configured) return json({ ok: false, error: 'provider_not_configured' }, 503);
      try {
        const { suggestions, needsLocation } = await suggestionsForAddress(env, parts);
        return json({ ok: true, suggestions, ...(needsLocation ? { needsLocation: true } : {}) });
      } catch {
        return json({ ok: false, error: 'provider_failed' }, 502);
      }
    }

    if (action === 'resolve') {
      const query = cleanQuery(payload.query);
      if (!query) return json({ ok: false, error: 'invalid_request' }, 400);
      // Exact house-number resolution: MapMap when it has the exact address,
      // otherwise the free Census Geocoder. Street-level or POI results are
      // never substituted for a requested house number.
      const resolved = await resolveAddress(env, query).catch(() => null);
      if (!resolved) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, result: resolved });
    }

    if (action === 'reverse') {
      const lat = typeof payload.lat === 'number' ? payload.lat : Number(payload.lat);
      const lng = typeof payload.lng === 'number' ? payload.lng : Number(payload.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return json({ ok: false, error: 'invalid_request' }, 400);
      }
      if (!configured) return json({ ok: false, error: 'provider_not_configured' }, 503);
      const result = await reverseGeocode(env, lat, lng).catch(() => null);
      if (!result) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, result });
    }

    if (action === 'resolve-id') {
      if (!configured) return json({ ok: false, error: 'provider_not_configured' }, 503);
      const id = typeof payload.id === 'string' ? payload.id.trim().slice(0, 120) : '';
      if (!id) return json({ ok: false, error: 'invalid_request' }, 400);
      const result = await mapMapResolveId(env, id).catch(() => null);
      if (!result) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, result });
    }

    return json({ ok: false, error: 'invalid_request' }, 400);
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
