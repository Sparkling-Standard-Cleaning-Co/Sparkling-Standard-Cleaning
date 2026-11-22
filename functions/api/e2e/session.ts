// POST /api/e2e/session — exchanges the owner-supplied E2E token for a
// short-lived, host-bound, HttpOnly session cookie. Only the exact host named
// by E2E_ALLOWED_HOSTS can use this endpoint, and only while E2E_AUTH_TOKEN is
// configured. Ordinary preview hosts and production never reach it.
import {
  E2E_TOKEN_HEADER,
  constantTimeEqual,
  createE2ESession,
  e2eConfigured,
  e2eSessionCookie,
  e2eToken,
  isE2EHost,
} from '../../../src/lib/env/preview-e2e.ts';

interface Env {
  E2E_ALLOWED_HOSTS?: string;
  E2E_AUTH_TOKEN?: string;
}

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; reset: number }>();

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      ...extra,
    },
  });
}

function throttled(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!e2eConfigured(env, host)) return json({ ok: false, error: 'not_available' }, 404);

  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('x-forwarded-for') ??
    'unknown';
  if (throttled(ip)) return json({ ok: false, error: 'rate_limited' }, 429);

  const origin = (request.headers.get('Origin') ?? '').trim().toLowerCase();
  if (origin && origin !== `https://${host}`) {
    return json({ ok: false, error: 'origin_rejected' }, 403);
  }

  const supplied = (request.headers.get(E2E_TOKEN_HEADER) ?? '').trim();
  if (!supplied || !(await constantTimeEqual(supplied, e2eToken(env)))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const session = await createE2ESession(e2eToken(env), host);
  return json(
    { ok: true, host, expiresAt: session.expiresAt },
    200,
    { 'Set-Cookie': e2eSessionCookie(session, url.protocol === 'https:') },
  );
}

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  const host = new URL(context.request.url).hostname.toLowerCase();
  if (!e2eConfigured(context.env, host) || !isE2EHost(host, context.env.E2E_ALLOWED_HOSTS)) {
    return json({ ok: false, error: 'not_available' }, 404);
  }
  return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'POST' });
}
