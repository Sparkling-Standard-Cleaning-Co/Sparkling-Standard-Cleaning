import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  authenticate,
  createOpsSession,
  enrollOwner,
  expiredSessionCookie,
  rateLimit,
  readOpsActor,
  requireCsrf,
  revokeSession,
  sessionCookie,
  setupRequired,
} from '../../../src/lib/admin/operations.ts';
import { constantTimeEqual, hashToken } from '../../../src/lib/admin/auth.ts';

interface Env extends AdminDbEnv {
  ADMIN_SETUP_CODE?: string;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function safeText(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function ready(env: Env): Promise<D1Database> {
  const db = adminDb(env);
  if (!db) throw new AdminAuthError(503, 'database_not_configured');
  return db;
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, configured: false, error: 'database_not_configured' }, 503);
  try {
    const required = await setupRequired(db);
    const actor = required ? null : await readOpsActor(db, context.request);
    return json({
      ok: true,
      configured: true,
      setupRequired: required,
      authenticated: Boolean(actor),
      actor: actor
        ? {
            id: actor.id,
            email: actor.email,
            name: actor.name,
            role: actor.role,
            branchId: actor.branchId,
            permissions: actor.permissions,
          }
        : null,
      csrf: actor?.csrf ?? null,
    });
  } catch {
    return json({ ok: false, configured: true, error: 'auth_status_failed' }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  let db: D1Database;
  try {
    db = await ready(context.env);
  } catch (error) {
    return json({ ok: false, error: (error as AdminAuthError).code }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await context.request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const action = safeText(payload.action, 20);
  const ip = context.request.headers.get('CF-Connecting-IP') ?? 'local';
  const ipKey = `ops:ip:${await hashToken(ip)}`;

  if (action === 'setup') {
    const required = await setupRequired(db);
    if (!required) return json({ ok: false, error: 'already_configured' }, 409);
    const expected = context.env.ADMIN_SETUP_CODE?.trim();
    if (!expected) return json({ ok: false, error: 'setup_unavailable' }, 503);
    if (!(await rateLimit(db, `ops:setup:${await hashToken(ip)}`, 10, 15, 15))) {
      return json({ ok: false, error: 'rate_limited' }, 429);
    }
    if (!constantTimeEqual(safeText(payload.setupCode, 200), expected)) {
      return json({ ok: false, error: 'setup_code_invalid' }, 403);
    }
    const email = safeText(payload.email, 200).toLowerCase();
    const password = safeText(payload.password, 200);
    const name = safeText(payload.name, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return json({ ok: false, error: 'email_invalid' }, 400);
    }
    try {
      const owner = await enrollOwner(db, { email, name, password });
      const session = await createOpsSession(db, owner.id, context.request);
      return json(
        { ok: true, actor: { ...owner, permissions: ['*'] }, csrf: session.csrf },
        200,
        { 'Set-Cookie': sessionCookie(session.token, context.request) },
      );
    } catch (error) {
      const status = error instanceof AdminAuthError ? error.status : 400;
      const code = error instanceof AdminAuthError ? error.code : 'setup_failed';
      return json({ ok: false, error: code }, status);
    }
  }

  if (action === 'login') {
    if (!(await rateLimit(db, ipKey, 10, 15, 15))) {
      return json({ ok: false, error: 'rate_limited' }, 429);
    }
    const email = safeText(payload.email, 200).toLowerCase();
    const password = safeText(payload.password, 200);
    if (!email || !password) return json({ ok: false, error: 'credentials_required' }, 400);
    if (!(await rateLimit(db, `ops:login:${await hashToken(email)}`, 20, 15, 15))) {
      return json({ ok: false, error: 'rate_limited' }, 429);
    }
    const actor = await authenticate(db, email, password);
    if (!actor) return json({ ok: false, error: 'credentials_invalid' }, 401);
    const session = await createOpsSession(db, actor.id, context.request);
    return json(
      {
        ok: true,
        actor: {
          id: actor.id,
          email: actor.email,
          name: actor.name,
          role: actor.role,
          branchId: actor.branchId,
        },
        csrf: session.csrf,
      },
      200,
      { 'Set-Cookie': sessionCookie(session.token, context.request) },
    );
  }

  if (action === 'logout') {
    const actor = await readOpsActor(db, context.request);
    if (!actor) return json({ ok: true }, 200, { 'Set-Cookie': expiredSessionCookie(context.request) });
    try {
      requireCsrf(context.request, actor);
    } catch (error) {
      return json({ ok: false, error: (error as AdminAuthError).code }, 403);
    }
    await revokeSession(db, context.request);
    return json({ ok: true }, 200, { 'Set-Cookie': expiredSessionCookie(context.request) });
  }

  return json({ ok: false, error: 'invalid_action' }, 400);
}
