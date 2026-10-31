import { bookingConfig } from '../../src/config/booking.ts';
import { availabilityForRange, type BookingEnv } from '../../src/lib/booking/service.ts';

const hits = new Map<string, { count: number; reset: number }>();
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function throttled(request: Request): boolean {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) { hits.set(ip, { count: 1, reset: now + 60_000 }); return false; }
  entry.count += 1;
  return entry.count > 12;
}
function validDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ? value : null;
}
export async function onRequestGet(context: { request: Request; env: BookingEnv }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);
  const url = new URL(request.url);
  const from = validDate(url.searchParams.get('from'));
  const to = validDate(url.searchParams.get('to'));
  if (!from || !to || to < from) return json({ ok: false, error: 'invalid_range' }, 400);
  if (Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86_400_000) > 42) {
    return json({ ok: false, error: 'range_too_large' }, 400);
  }
  const durationRaw = Number(url.searchParams.get('durationMinutes'));
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(durationRaw) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const result = await availabilityForRange(env, {
    from, to, durationMinutes: durationRaw, destination: { lat, lng },
  });
  if (!result.ok) return json({ ok: true, enabled: false, reason: result.reason, days: [] });
  return json({
    ok: true,
    enabled: true,
    timeZone: result.timeZone,
    timeZoneLabel: bookingConfig.timeZoneLabel,
    from,
    to,
    days: result.days,
  });
}
