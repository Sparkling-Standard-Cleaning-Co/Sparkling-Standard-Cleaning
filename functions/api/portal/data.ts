import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError } from '../../../src/lib/admin/operations.ts';
import { createPortalBillingSession } from '../../../src/lib/admin/stripe-billing.ts';
import { checkPublicRateLimit, clientIp, consumePublicRateLimit, PUBLIC_RATE_LIMITS } from '../../../src/lib/public-rate-limit.ts';
import {
  createPortalServiceRequest,
  hashPortalToken,
  portalSnapshot,
  readPortalSession,
  requirePortalCsrf,
  sameOriginRequest,
  type PortalEnv,
} from '../../../src/lib/portal/service.ts';

interface Env extends AdminDbEnv, PortalEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const session = await readPortalSession(db, context.request);
    if (!session) return json({ ok: false, error: 'authentication_required' }, 401);
    const snapshot = await portalSnapshot(db, session, context.env);
    return json({ ok: true, csrf: session.csrf, ...snapshot });
  } catch {
    return json({ ok: false, error: 'portal_data_failed' }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  if (!sameOriginRequest(context.request)) return json({ ok: false, error: 'origin_invalid' }, 403);
  try {
    const session = await readPortalSession(db, context.request);
    if (!session) return json({ ok: false, error: 'authentication_required' }, 401);
    requirePortalCsrf(session, context.request.headers.get('X-Portal-CSRF'));
    const ip = clientIp(context.request);
    const status = await checkPublicRateLimit(db, 'portal-action-ip', ip, PUBLIC_RATE_LIMITS.portalActionIp);
    if (status.limited) return json({ ok: false, error: 'rate_limited', retryAfterSeconds: status.retryAfterSeconds }, 429);
    await consumePublicRateLimit(db, 'portal-action-ip', ip, PUBLIC_RATE_LIMITS.portalActionIp);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'service_request') {
      const result = await createPortalServiceRequest(
        db,
        context.env,
        session,
        {
          kind: body.kind,
          message: body.message,
          ...(body.appointmentId ? { appointmentId: body.appointmentId } : {}),
        },
        await hashPortalToken(ip),
      );
      return json({ ok: true, requestId: result.id, message: 'Your request was received. Our customer-service team will follow up.' });
    }
    if (action === 'billing_portal') {
      const result = await createPortalBillingSession(db, session.customerId, session.email, context.env);
      return json({ ok: true, url: result.url });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    if (error instanceof AdminAuthError) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: 'portal_action_failed' }, 500);
  }
}
