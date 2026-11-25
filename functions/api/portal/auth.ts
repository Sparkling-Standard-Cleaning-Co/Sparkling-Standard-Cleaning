import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError } from '../../../src/lib/admin/operations.ts';
import { checkPublicRateLimit, clientIp, consumePublicRateLimit, PUBLIC_RATE_LIMITS } from '../../../src/lib/public-rate-limit.ts';
import {
  clearPortalCookieHeader,
  hashPortalToken,
  normalizePortalEmail,
  portalCookieHeader,
  readPortalSession,
  requestPortalAccess,
  requirePortalCsrf,
  revokePortalSession,
  sameOriginRequest,
  verifyPortalToken,
  type PortalEnv,
} from '../../../src/lib/portal/service.ts';

interface Env extends AdminDbEnv, PortalEnv {}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function requestHashes(request: Request): Promise<{ ipHash: string; userAgentHash: string }> {
  return {
    ipHash: await hashPortalToken(clientIp(request)),
    userAgentHash: await hashPortalToken(request.headers.get('User-Agent') ?? 'unknown'),
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const session = await readPortalSession(db, context.request);
    if (!session) {
      return json({ ok: true, authenticated: false }, 200, { 'Set-Cookie': clearPortalCookieHeader() });
    }
    return json({
      ok: true,
      authenticated: true,
      csrf: session.csrf,
      name: session.name,
      email: session.email,
    });
  } catch {
    return json({ ok: false, error: 'portal_session_failed' }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  if (!sameOriginRequest(context.request)) return json({ ok: false, error: 'origin_invalid' }, 403);
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const ip = clientIp(context.request);
    const hashes = await requestHashes(context.request);

    if (action === 'request_access') {
      const ipStatus = await checkPublicRateLimit(db, 'portal-access-ip', ip, PUBLIC_RATE_LIMITS.portalIp);
      if (ipStatus.limited) return json({ ok: false, error: 'rate_limited', retryAfterSeconds: ipStatus.retryAfterSeconds }, 429);
      await consumePublicRateLimit(db, 'portal-access-ip', ip, PUBLIC_RATE_LIMITS.portalIp);
      const email = normalizePortalEmail(body.email);
      if (email) {
        const emailStatus = await checkPublicRateLimit(db, 'portal-access-email', email, PUBLIC_RATE_LIMITS.portalEmail);
        if (!emailStatus.limited) {
          await consumePublicRateLimit(db, 'portal-access-email', email, PUBLIC_RATE_LIMITS.portalEmail);
          await requestPortalAccess(db, context.env, { email, ...hashes });
        }
      }
      return json({
        ok: true,
        message: 'If that email belongs to an active Sparkling Standard customer, a secure sign-in link is on its way.',
      });
    }

    if (action === 'verify') {
      const ipStatus = await checkPublicRateLimit(db, 'portal-verify-ip', ip, PUBLIC_RATE_LIMITS.portalIp);
      if (ipStatus.limited) return json({ ok: false, error: 'rate_limited', retryAfterSeconds: ipStatus.retryAfterSeconds }, 429);
      await consumePublicRateLimit(db, 'portal-verify-ip', ip, PUBLIC_RATE_LIMITS.portalIp);
      const verified = await verifyPortalToken(db, body.token, hashes);
      if (!verified) return json({ ok: false, error: 'invalid_or_expired_link' }, 400);
      return json(
        { ok: true, authenticated: true, csrf: verified.csrf, name: verified.name },
        200,
        { 'Set-Cookie': portalCookieHeader(verified.sessionToken) },
      );
    }

    if (action === 'logout') {
      const session = await readPortalSession(db, context.request);
      if (session) requirePortalCsrf(session, context.request.headers.get('X-Portal-CSRF'));
      await revokePortalSession(db, context.request);
      return json({ ok: true }, 200, { 'Set-Cookie': clearPortalCookieHeader() });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    if (error instanceof AdminAuthError) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: 'portal_auth_failed' }, 500);
  }
}
