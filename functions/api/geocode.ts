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
  censusResolve,
  featureId,
  featureLabel,
  mapMapKey,
  mapMapResolve,
  mapMapResolveId,
  type GeocodeEnv,
  type PhotonFeature,
} from '../../src/lib/location/server-geocode.ts';

interface Env extends GeocodeEnv {}

const MAX_QUERY = 120;
const MIN_QUERY = 3;
const SUGGEST_LIMIT = 6;
const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = 20;
const DAILY_CAP = 500;

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
function parseSuggestPayload(data: unknown): Suggestion[] {
  const list: Suggestion[] = [];
  const rows = (data as { suggestions?: unknown })?.suggestions;
  if (Array.isArray(rows)) {
    for (const row of rows as Array<Record<string, unknown>>) {
      const id = typeof row.id === 'string' ? row.id : '';
      const name = typeof row.name === 'string' ? row.name : '';
      const context = typeof row.context === 'string' ? row.context : '';
      const label = [name, context].filter(Boolean).join(', ');
      const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : undefined;
      const lng = typeof row.lon === 'number' && Number.isFinite(row.lon) ? row.lon : undefined;
      if (!id || !label) continue;
      list.push({ id, label, ...(lat !== undefined ? { lat } : {}), ...(lng !== undefined ? { lng } : {}) });
    }
    return list;
  }
  const features = (data as { features?: PhotonFeature[] })?.features;
  for (const feature of features ?? []) {
    const label = featureLabel(feature);
    const id = featureId(feature);
    if (label && id) list.push({ id, label });
  }
  return list;
}

async function suggestions(env: Env, query: string): Promise<Suggestion[]> {
  const response = await fetch(
    `${(env.MAPMAP_BASE?.trim() || 'https://api.mapmap.ai').replace(/\/+$/, '')}` +
      `/geocode/suggest?q=${encodeURIComponent(query)}&limit=${SUGGEST_LIMIT}` +
      `&bias=${encodeURIComponent(SUGGEST_BIAS)}&lang=en`,
    { headers: { Authorization: `Bearer ${mapMapKey(env)}` } },
  );
  if (response.status !== 200) throw new Error(`provider HTTP ${response.status}`);
  const data = await response.json().catch(() => ({}));
  return parseSuggestPayload(data);
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  if (throttled(request)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  let payload: { action?: unknown; query?: unknown; id?: unknown };
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
      if (!query) return json({ ok: false, error: 'invalid_request' }, 400);
      if (!configured) return json({ ok: false, error: 'provider_not_configured' }, 503);
      try {
        return json({ ok: true, suggestions: await suggestions(env, query) });
      } catch {
        return json({ ok: false, error: 'provider_failed' }, 502);
      }
    }

    if (action === 'resolve') {
      const query = cleanQuery(payload.query);
      if (!query) return json({ ok: false, error: 'invalid_request' }, 400);
      if (configured) {
        const provider = await mapMapResolve(env, query).catch(() => null);
        if (provider) return json({ ok: true, result: provider });
        // Fall through to Census when MapMap has no match or errors.
      }
      const census = await censusResolve(query).catch(() => null);
      if (!census) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, result: census });
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
