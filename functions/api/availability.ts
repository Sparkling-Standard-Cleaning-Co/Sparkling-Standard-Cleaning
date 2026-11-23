// GET /api/availability — genuine owner-calendar availability for one date.
//
// Never invents slots. Returns enabled:false until the dedicated Google
// Calendar is connected and booking is enabled. Calendar, geocode and route
// failures withhold slots rather than guessing.

import { bookingConfig } from '../../src/config/booking.ts';
import { availabilityForDate, type BookingEnv } from '../../src/lib/booking/service.ts';
import { resolveServiceBranchForPoint, resolveServiceBranchStrict } from '../../src/lib/branches/registry.ts';
import { reverseGeocode } from '../../src/lib/location/server-geocode.ts';

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
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 30;
}

function validDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? value : null;
}

export async function onRequestGet(context: { request: Request; env: BookingEnv }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);
  const url = new URL(request.url);
  const date = validDate(url.searchParams.get('date'));
  if (!date) return json({ ok: false, error: 'invalid_date' }, 400);
  if (!bookingConfig.enabled) {
    return json({ ok: true, enabled: false, reason: 'booking_not_enabled', slots: [] });
  }
  const durationRaw = Number(url.searchParams.get('durationMinutes'));
  if (!Number.isFinite(durationRaw)) return json({ ok: false, error: 'invalid_duration' }, 400);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ ok: false, error: 'destination_required' }, 400);
  }
  let zip = (url.searchParams.get('zip') ?? '').trim();
  if (!/^\d{5}$/.test(zip)) {
    const reverse = await reverseGeocode(env, lat, lng).catch(() => null);
    zip = reverse?.zip?.trim() ?? '';
  }
  let resolved = await resolveServiceBranchStrict(env.DB ?? null, { zip, state: null });
  if (!resolved.branch && !zip) {
    resolved = await resolveServiceBranchForPoint(env.DB ?? null, { lat, lng });
  }
  if (!resolved.branch) {
    return json({
      ok: true,
      enabled: false,
      reason: 'service_area_inquiry_required',
      branchReason: resolved.reason,
      slots: [],
    });
  }
  if (!resolved.branch.bookable) {
    return json({
      ok: true,
      enabled: false,
      reason: 'branch_not_bookable',
      branch: resolved.branch.id,
      slots: [],
    });
  }

  const result = await availabilityForDate(env, {
    date,
    durationMinutes: durationRaw,
    destination: { lat, lng },
    branchId: resolved.branch.id,
  });
  if (!result.ok) {
    return json({ ok: true, enabled: false, reason: result.reason, slots: [] });
  }
  return json({
    ok: true,
    timeZone: result.timeZone,
    timeZoneLabel: result.timeZone === 'America/New_York' ? 'Eastern Time' : 'Central Time',
    branch: result.branchId,
    date,
    durationMinutes: result.durationMinutes,
    confirmationMode: bookingConfig.confirmationMode,
    available: result.availability.available,
    enabled: result.availability.enabled,
    ...(result.availability.reason ? { reason: result.availability.reason } : {}),
    // Staffing assignments are server-owned; the public picker receives only
    // the times a customer may choose.
    slots: result.availability.slots.map(({ start, end, startLabel, endLabel }) => ({
      start,
      end,
      startLabel,
      endLabel,
    })),
  });
}
