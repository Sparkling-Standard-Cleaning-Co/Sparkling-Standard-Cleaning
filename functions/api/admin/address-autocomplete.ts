// Owner/manager address autocomplete for admin forms.
//
// Google Places API (New) is called with the private server key. The browser
// receives only place predictions and normalized address components. No API
// key, session secret or privileged credential is returned.

import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  rateLimit,
  requireActor,
  requireCsrf,
} from '../../../src/lib/admin/operations.ts';
import {
  adminAddressDetails,
  adminAddressSuggestions,
} from '../../../src/lib/location/admin-address.ts';
import type { GeocodeEnv } from '../../../src/lib/location/server-geocode.ts';

interface Env extends AdminDbEnv, GeocodeEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function branchFor(actor: { role: string; branchId: string | null }, requested: string): string {
  if (actor.role !== 'owner' && actor.branchId) return actor.branchId;
  const candidate = text(requested, 80);
  if (candidate === 'branch_pensacola' || candidate === 'branch_tampa') return candidate;
  return actor.branchId ?? 'branch_pensacola';
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (
      actor.role !== 'owner' &&
      !actor.permissions.includes('customer.write') &&
      !actor.permissions.includes('booking.write')
    ) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }
    requireCsrf(context.request, actor);
    if (!(await rateLimit(db, `admin-address:${actor.id}`, 90, 5, 5))) {
      return json({ ok: false, error: 'rate_limited' }, 429);
    }
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 30);
    const sessionToken = text(body.sessionToken, 100);
    if (action === 'suggest') {
      const query = text(body.query, 160);
      if (query.length < 3) return json({ ok: false, error: 'query_required' }, 400);
      try {
        const result = await adminAddressSuggestions(context.env, {
          query,
          branchId: branchFor(actor, text(body.branchId, 80)),
          ...(sessionToken ? { sessionToken } : {}),
        });
        return json({ ok: true, ...result, attribution: 'Google' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'google_places_not_configured') {
          return json({ ok: false, error: 'google_places_not_configured' }, 503);
        }
        return json({ ok: false, error: 'address_suggestions_unavailable' }, 502);
      }
    }
    if (action === 'details') {
      const placeId = text(body.placeId, 200);
      if (!/^[A-Za-z0-9_-]{5,200}$/.test(placeId)) {
        return json({ ok: false, error: 'place_id_invalid' }, 400);
      }
      try {
        const details = await adminAddressDetails(context.env, {
          placeId,
          ...(sessionToken ? { sessionToken } : {}),
        });
        if (!details) return json({ ok: false, error: 'place_not_found' }, 404);
        return json({ ok: true, details, attribution: 'Google' });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'google_places_not_configured') {
          return json({ ok: false, error: 'google_places_not_configured' }, 503);
        }
        return json({ ok: false, error: 'address_details_unavailable' }, 502);
      }
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'address_autocomplete_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
