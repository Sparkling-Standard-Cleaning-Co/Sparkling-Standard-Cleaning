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
//  - Provider keys live only in the function environment (MAPMAP_API_KEY).
//  - The private operating origin is NEVER read, returned or logged here.
//  - Requests are throttled per client IP and capped per isolate-days as a
//    circuit breaker; the MapMap free tier cannot bill, and Census is free.
//  - Only minimal fields are returned to the browser (label, coords, id).
//
// Responses: 200 { ok: true, ... } | 400 | 404 | 405 | 429 | 502 | 503

interface Env {
  /** Existing shared routing secret configured in Cloudflare (preferred). */
  ROUTES_API_KEY?: string;
  /** Optional alias so the function also works with a dedicated key. */
  MAPMAP_API_KEY?: string;
  MAPMAP_BASE?: string;
}

/** One provider credential for all mapping functions — no duplicate secrets. */
function mapMapKey(env: Env): string {
  return env.ROUTES_API_KEY?.trim() || env.MAPMAP_API_KEY?.trim() || '';
}

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
}

function mapMapBase(env: Env): string {
  return (env.MAPMAP_BASE?.trim() || 'https://api.mapmap.ai').replace(/\/+$/, '');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type PhotonFeature = {
  properties?: Record<string, any>;
  geometry?: { coordinates?: [number, number] };
};

function featureLabel(feature: PhotonFeature): string | null {
  const p = feature.properties ?? {};
  const label =
    (typeof p.label === 'string' && p.label) ||
    [p.name, p.street, p.city, p.state, p.postcode].filter((part) => typeof part === 'string' && part).join(', ');
  return label || null;
}

function featureId(feature: PhotonFeature): string | null {
  const p = feature.properties ?? {};
  if (typeof p.id === 'string') return p.id;
  if (p.osm_type !== undefined && p.osm_id !== undefined) return `${p.osm_type}${p.osm_id}`;
  return null;
}

async function mapMapJson(env: Env, path: string): Promise<{ status: number; data: any }> {
  const response = await fetch(`${mapMapBase(env)}${path}`, {
    headers: { Authorization: `Bearer ${mapMapKey(env)}` },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function censusResolve(query: string): Promise<{ label: string; lat: number; lng: number } | null> {
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
  return { label: match.matchedAddress, lat, lng };
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
      const { status, data } = await mapMapJson(
        env,
        `/geocode/suggest?q=${encodeURIComponent(query)}&limit=${SUGGEST_LIMIT}&country=us`,
      );
      if (status !== 200) return json({ ok: false, error: 'provider_failed' }, 502);
      const suggestions: Suggestion[] = [];
      for (const feature of (data?.features ?? []) as PhotonFeature[]) {
        const label = featureLabel(feature);
        const id = featureId(feature);
        if (label && id) suggestions.push({ id, label });
      }
      return json({ ok: true, suggestions });
    }

    if (action === 'resolve') {
      const query = cleanQuery(payload.query);
      if (!query) return json({ ok: false, error: 'invalid_request' }, 400);
      if (configured) {
        const { status, data } = await mapMapJson(
          env,
          `/geocode?q=${encodeURIComponent(query)}&limit=1&country=us`,
        );
        if (status === 200) {
          const feature = (data?.features ?? [])[0] as PhotonFeature | undefined;
          const coords = feature?.geometry?.coordinates;
          const label = feature ? featureLabel(feature) : null;
          if (label && Array.isArray(coords) && coords.length === 2) {
            const [lng, lat] = coords;
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              return json({ ok: true, result: { label, lat, lng, source: 'mapmap' } });
            }
          }
        }
        // Fall through to Census when MapMap has no match or errors.
      }
      const census = await censusResolve(query);
      if (!census) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, result: { ...census, source: 'census' } });
    }

    if (action === 'resolve-id') {
      if (!configured) return json({ ok: false, error: 'provider_not_configured' }, 503);
      const id = typeof payload.id === 'string' ? payload.id.trim().slice(0, 120) : '';
      if (!id) return json({ ok: false, error: 'invalid_request' }, 400);
      const { status, data } = await mapMapJson(env, `/geocode/retrieve?id=${encodeURIComponent(id)}`);
      if (status !== 200) return json({ ok: false, error: 'provider_failed' }, 502);
      const feature = (data?.features ?? [])[0] as PhotonFeature | undefined;
      const coords = feature?.geometry?.coordinates;
      const label = feature ? featureLabel(feature) : null;
      if (!label || !Array.isArray(coords) || coords.length !== 2) {
        return json({ ok: false, error: 'not_found' }, 404);
      }
      const [lng, lat] = coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json({ ok: false, error: 'not_found' }, 404);
      }
      return json({ ok: true, result: { label, lat, lng, source: 'mapmap' } });
    }

    return json({ ok: false, error: 'invalid_request' }, 400);
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
