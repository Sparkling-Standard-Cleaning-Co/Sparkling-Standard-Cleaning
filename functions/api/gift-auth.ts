// Administrator authentication for the private gift financial register.
//
// GET  /api/gift-auth                 session + configuration state
// POST /api/gift-auth                 action-based authentication
//
// Actions: setup, login, logout, recover, reset, verify-email,
//          update-recovery. Financial permissions live in /api/gift-admin.

import { customerEmailProblem, normalizeCustomerEmail } from '../../src/lib/forms/contact-email.ts';
import {
  adminBucket,
  audit,
  createAdmin,
  createChallenge,
  createSession,
  deleteSession,
  expiredSessionCookie,
  hashPassword,
  invalidateAllSessions,
  passwordProblem,
  readAdmin,
  readSession,
  requestIp,
  requestUserAgent,
  sessionCookie,
  sessionTokenFromRequest,
  consumeChallenge,
  constantTimeEqual,
  verifyPassword,
  writeAdmin,
  type AdminRecord,
  type AdminStorageEnv,
  type AdminSession,
} from '../../src/lib/admin/auth.ts';
import {
  buildPasswordChangedEmail,
  buildRecoveryEmail,
  buildVerifyEmail,
  sendAdminEmail,
  type AdminEmailEnv,
} from '../../src/lib/admin/email.ts';

interface Env extends AdminStorageEnv, AdminEmailEnv {
  GIFT_ADMIN_SETUP_CODE?: string;
}

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; resetAt: number }>();

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

function throttled(ip: string): boolean {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  failures.set(ip, {
    count: (entry && entry.resetAt > now ? entry.count : 0) + 1,
    resetAt: now + WINDOW_MS,
  });
}

function clearFailures(ip: string): void {
  failures.delete(ip);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = (await request.json()) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sessionPublic(session: AdminSession, admin: AdminRecord) {
  return {
    csrf: session.csrf,
    expiresAt: session.expiresAt,
    admin: {
      recoveryEmail: admin.recoveryEmail ?? '',
      recoveryEmailVerified: admin.recoveryEmailVerified,
      recoveryPhone: admin.recoveryPhone ?? '',
      recoveryPhoneVerified: admin.recoveryPhoneVerified,
    },
  };
}

async function requireSession(
  request: Request,
  bucket: NonNullable<ReturnType<typeof adminBucket>>,
): Promise<{ session: AdminSession; admin: AdminRecord } | null> {
  const session = await readSession(bucket, sessionTokenFromRequest(request));
  if (!session) return null;
  const admin = await readAdmin(bucket);
  if (!admin) return null;
  return { session, admin };
}

function csrfMatches(request: Request, session: AdminSession): boolean {
  const token = request.headers.get('X-CSRF-Token') ?? '';
  return Boolean(token) && constantTimeEqual(token, session.csrf);
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const bucket = adminBucket(env);
  if (!bucket) return json({ ok: false, error: 'auth_storage_not_configured' }, 503);
  const admin = await readAdmin(bucket);
  if (!admin) {
    return json({
      ok: true,
      configured: false,
      authenticated: false,
      phoneRecovery: { available: false, reason: 'sms_provider_not_configured' },
    });
  }
  const session = await readSession(bucket, sessionTokenFromRequest(request));
  if (!session) {
    return json({
      ok: true,
      configured: true,
      authenticated: false,
      phoneRecovery: { available: false, reason: 'sms_provider_not_configured' },
    });
  }
  return json({
    ok: true,
    configured: true,
    authenticated: true,
    session: sessionPublic(session, admin),
    phoneRecovery: { available: false, reason: 'sms_provider_not_configured' },
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!sameOrigin(request)) return json({ ok: false, error: 'origin_rejected' }, 403);
  const bucket = adminBucket(env);
  if (!bucket) return json({ ok: false, error: 'auth_storage_not_configured' }, 503);
  const payload = await readJson(request);
  if (!payload) return json({ ok: false, error: 'invalid_request' }, 400);
  const action = text(payload.action, 40);
  const ip = requestIp(request);
  const userAgent = requestUserAgent(request);

  if (action === 'setup') {
    if (await readAdmin(bucket)) return json({ ok: false, error: 'already_configured' }, 409);
    const expected = env.GIFT_ADMIN_SETUP_CODE?.trim() ?? '';
    if (!expected) return json({ ok: false, error: 'setup_unavailable' }, 503);
    if (throttled(`setup:${ip}`)) return json({ ok: false, error: 'rate_limited' }, 429);
    const supplied = text(payload.setupCode, 200);
    if (!supplied || !constantTimeEqual(supplied, expected)) {
      recordFailure(`setup:${ip}`);
      await audit(bucket, 'admin.setup', { success: false, ip });
      return json({ ok: false, error: 'setup_rejected' }, 401);
    }
    const password = typeof payload.password === 'string' ? payload.password : '';
    const passwordIssue = passwordProblem(password);
    if (passwordIssue) return json({ ok: false, error: 'weak_password', message: passwordIssue }, 400);
    const recoveryEmail = normalizeCustomerEmail(payload.recoveryEmail);
    const emailIssue = recoveryEmail ? customerEmailProblem(recoveryEmail) : null;
    if (emailIssue) return json({ ok: false, error: 'recovery_email_invalid' }, 400);
    const now = new Date().toISOString();
    const admin: AdminRecord = {
      version: 1,
      passwordHash: await hashPassword(password),
      ...(recoveryEmail ? { recoveryEmail } : {}),
      recoveryEmailVerified: false,
      recoveryPhoneVerified: false,
      createdAt: now,
      updatedAt: now,
    };
    const created = await createAdmin(bucket, admin);
    if (!created) return json({ ok: false, error: 'already_configured' }, 409);
    clearFailures(`setup:${ip}`);
    const { token, session } = await createSession(bucket, { ip, userAgent });
    let verificationSent = false;
    if (recoveryEmail && env.RESEND_API_KEY) {
      const challenge = await createChallenge(bucket, 'verify_email', { email: recoveryEmail });
      verificationSent = await sendAdminEmail(
        env,
        recoveryEmail,
        buildVerifyEmail(env, challenge.token),
        `admin-verify-${challenge.challenge.tokenHash.slice(0, 24)}`,
      );
    }
    await audit(bucket, 'admin.setup', { success: true, ip, actor: 'hayli' });
    return json(
      { ok: true, session: sessionPublic(session, admin), verificationSent },
      200,
      { 'Set-Cookie': sessionCookie(token) },
    );
  }

  if (action === 'login') {
    const admin = await readAdmin(bucket);
    if (!admin) return json({ ok: false, error: 'not_configured' }, 503);
    if (throttled(ip)) return json({ ok: false, error: 'rate_limited' }, 429);
    const password = typeof payload.password === 'string' ? payload.password : '';
    const valid = password.length > 0 && password.length <= 200 && (await verifyPassword(password, admin.passwordHash));
    if (!valid) {
      recordFailure(ip);
      await audit(bucket, 'admin.login', { success: false, ip });
      return json({ ok: false, error: 'invalid_credentials' }, 401);
    }
    clearFailures(ip);
    const { token, session } = await createSession(bucket, { ip, userAgent });
    await audit(bucket, 'admin.login', { success: true, ip, actor: 'hayli' });
    return json(
      { ok: true, session: sessionPublic(session, admin) },
      200,
      { 'Set-Cookie': sessionCookie(token) },
    );
  }

  if (action === 'logout') {
    const token = sessionTokenFromRequest(request);
    await deleteSession(bucket, token);
    await audit(bucket, 'admin.logout', { success: true, ip, actor: 'hayli' });
    return json({ ok: true }, 200, { 'Set-Cookie': expiredSessionCookie() });
  }

  if (action === 'recover') {
    // Always return the same response: recovery must not reveal whether the
    // account or a verified recovery channel exists.
    if (throttled(`recover:${ip}`)) return json({ ok: true, accepted: true });
    recordFailure(`recover:${ip}`);
    const admin = await readAdmin(bucket);
    const channel = text(payload.channel, 20);
    if (admin && channel === 'email' && admin.recoveryEmail && admin.recoveryEmailVerified) {
      const challenge = await createChallenge(bucket, 'reset_password', { email: admin.recoveryEmail });
      await sendAdminEmail(
        env,
        admin.recoveryEmail,
        buildRecoveryEmail(env, challenge.token),
        `admin-reset-${challenge.challenge.tokenHash.slice(0, 24)}`,
      );
      await audit(bucket, 'admin.recovery.request', { success: true, ip, detail: 'email' });
    } else {
      await audit(bucket, 'admin.recovery.request', { success: false, ip, detail: channel.slice(0, 20) });
    }
    return json({ ok: true, accepted: true });
  }

  if (action === 'reset') {
    if (throttled(`reset:${ip}`)) return json({ ok: false, error: 'rate_limited' }, 429);
    const token = text(payload.token, 300);
    const password = typeof payload.password === 'string' ? payload.password : '';
    const passwordIssue = passwordProblem(password);
    if (passwordIssue) return json({ ok: false, error: 'weak_password', message: passwordIssue }, 400);
    const challenge = await consumeChallenge(bucket, token, 'reset_password');
    if (!challenge) {
      recordFailure(`reset:${ip}`);
      await audit(bucket, 'admin.password.reset', { success: false, ip });
      return json({ ok: false, error: 'invalid_or_expired' }, 400);
    }
    const admin = await readAdmin(bucket);
    if (!admin || !challenge.email || admin.recoveryEmail !== challenge.email) {
      return json({ ok: false, error: 'invalid_or_expired' }, 400);
    }
    await writeAdmin(bucket, {
      ...admin,
      passwordHash: await hashPassword(password),
      updatedAt: new Date().toISOString(),
    });
    await invalidateAllSessions(bucket);
    await sendAdminEmail(env, challenge.email, buildPasswordChangedEmail(env), `admin-changed-${challenge.tokenHash.slice(0, 24)}`);
    await audit(bucket, 'admin.password.reset', { success: true, ip, actor: 'hayli' });
    return json({ ok: true });
  }

  if (action === 'verify-email') {
    const token = text(payload.token, 300);
    const challenge = await consumeChallenge(bucket, token, 'verify_email');
    if (!challenge?.email) return json({ ok: false, error: 'invalid_or_expired' }, 400);
    const admin = await readAdmin(bucket);
    if (!admin || admin.recoveryEmail !== challenge.email) {
      return json({ ok: false, error: 'invalid_or_expired' }, 400);
    }
    await writeAdmin(bucket, { ...admin, recoveryEmailVerified: true, updatedAt: new Date().toISOString() });
    await audit(bucket, 'admin.recovery.verify', { success: true, ip, actor: 'hayli' });
    return json({ ok: true });
  }

  if (action === 'update-recovery') {
    const auth = await requireSession(request, bucket);
    if (!auth) return json({ ok: false, error: 'unauthorized' }, 401);
    if (!csrfMatches(request, auth.session)) return json({ ok: false, error: 'csrf_failed' }, 403);
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (!(await verifyPassword(password, auth.admin.passwordHash))) {
      await audit(bucket, 'admin.recovery.update', { success: false, ip, actor: 'hayli' });
      return json({ ok: false, error: 'reauth_failed' }, 401);
    }
    const recoveryEmail = normalizeCustomerEmail(payload.recoveryEmail);
    const emailIssue = recoveryEmail ? customerEmailProblem(recoveryEmail) : null;
    if (!recoveryEmail || emailIssue) return json({ ok: false, error: 'recovery_email_invalid' }, 400);
    await writeAdmin(bucket, {
      ...auth.admin,
      recoveryEmail,
      recoveryEmailVerified: false,
      updatedAt: new Date().toISOString(),
    });
    const challenge = await createChallenge(bucket, 'verify_email', { email: recoveryEmail });
    const sent = await sendAdminEmail(
      env,
      recoveryEmail,
      buildVerifyEmail(env, challenge.token),
      `admin-verify-${challenge.challenge.tokenHash.slice(0, 24)}`,
    );
    await audit(bucket, 'admin.recovery.update', { success: true, ip, actor: 'hayli' });
    return json({ ok: true, verificationSent: sent });
  }

  return json({ ok: false, error: 'invalid_action' }, 400);
}
