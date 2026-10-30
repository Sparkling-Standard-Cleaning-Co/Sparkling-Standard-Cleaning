import {
  hashPassword,
  hashToken,
  passwordProblem,
  randomToken,
  verifyPassword,
} from './auth.ts';
import type { D1Database } from './d1.ts';

export const OPS_COOKIE = 'ss_ops';
export const OPS_SESSION_SECONDS = 8 * 60 * 60;

export interface AdminPermission {
  permission: string;
}

export interface AdminActor {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  csrf: string;
  permissions: string[];
  mfaEnabled: boolean;
}

export class AdminAuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function cookie(request: Request, name: string): string {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${OPS_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${OPS_SESSION_SECONDS}${secure}`;
}

export function expiredSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${OPS_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function setupRequired(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM admin_users').first<{ count: number }>();
  return Number(row?.count ?? 0) === 0;
}

export async function enrollOwner(
  db: D1Database,
  input: { email: string; name: string; password: string },
): Promise<{ id: string; email: string; name: string; role: string }> {
  const problem = passwordProblem(input.password);
  if (problem) throw new AdminAuthError(400, problem);
  const hash = await hashPassword(input.password);
  const id = `admin_${crypto.randomUUID()}`;
  const email = input.email.trim().toLowerCase();
  await db
    .prepare(
      `INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status)
       VALUES (?, 'owner', ?, ?, ?, 'active')`,
    )
    .bind(id, email, hash, input.name.trim() || 'Owner')
    .run();
  await audit(db, {
    actorUserId: id,
    action: 'admin.owner_enrolled',
    entityType: 'admin_user',
    entityId: id,
    detail: 'first-run owner enrollment',
  });
  return { id, email, name: input.name.trim() || 'Owner', role: 'owner' };
}

export async function authenticate(
  db: D1Database,
  emailInput: string,
  password: string,
): Promise<{ id: string; email: string; name: string; role: string; branchId: string | null; mfaEnabled: boolean } | null> {
  const email = emailInput.trim().toLowerCase();
  const user = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.password_hash, u.status, u.role_id, u.branch_id,
              u.mfa_enabled, r.name AS role_name
       FROM admin_users u JOIN admin_roles r ON r.id = u.role_id
       WHERE u.email = ? LIMIT 1`,
    )
    .bind(email)
    .first<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string;
      status: string;
      role_id: string;
      branch_id: string | null;
      mfa_enabled: number;
      role_name: string;
    }>();
  if (!user || user.status !== 'active') return null;
  if (!(await verifyPassword(password, user.password_hash))) return null;
  await db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  return {
    id: user.id,
    email: user.email,
    name: user.display_name,
    role: user.role_id,
    branchId: user.branch_id ?? null,
    mfaEnabled: Number(user.mfa_enabled) === 1,
  };
}

export async function createOpsSession(
  db: D1Database,
  userId: string,
  request: Request,
): Promise<{ token: string; csrf: string; expiresAt: string }> {
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const csrf = randomToken(24);
  const expiresAt = new Date(Date.now() + OPS_SESSION_SECONDS * 1000).toISOString();
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const userAgent = request.headers.get('User-Agent') ?? '';
  await db
    .prepare(
      `INSERT INTO admin_sessions
       (id, user_id, token_hash, csrf_token, ip_hash, user_agent_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `sess_${crypto.randomUUID()}`,
      userId,
      tokenHash,
      csrf,
      ip ? await hashToken(ip) : null,
      userAgent ? await hashToken(userAgent) : null,
      expiresAt,
    )
    .run();
  return { token, csrf, expiresAt };
}

export async function readOpsActor(db: D1Database, request: Request): Promise<AdminActor | null> {
  const token = cookie(request, OPS_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
              u.id, u.email, u.display_name, u.status, u.role_id, u.branch_id, u.mfa_enabled
       FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      session_id: string;
      csrf_token: string;
      expires_at: string;
      revoked_at: string | null;
      id: string;
      email: string;
      display_name: string;
      status: string;
      role_id: string;
      branch_id: string | null;
      mfa_enabled: number;
    }>();
  if (!row || row.revoked_at || row.status !== 'active') return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await db.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(row.session_id).run();
    return null;
  }
  const perms = await db
    .prepare('SELECT permission FROM admin_role_permissions WHERE role_id = ?')
    .bind(row.role_id)
    .all<AdminPermission>();
  const permissions = (perms.results ?? []).map((entry) => entry.permission);
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    role: row.role_id,
    branchId: row.branch_id ?? null,
    csrf: row.csrf_token,
    permissions,
    mfaEnabled: Number(row.mfa_enabled) === 1,
  };
}

export async function requireActor(
  db: D1Database,
  request: Request,
  permission?: string,
): Promise<AdminActor> {
  const actor = await readOpsActor(db, request);
  if (!actor) throw new AdminAuthError(401, 'unauthorized');
  if (permission && actor.role !== 'owner' && !actor.permissions.includes(permission)) {
    throw new AdminAuthError(403, 'forbidden');
  }
  return actor;
}

export function requireCsrf(request: Request, actor: AdminActor): void {
  const provided = request.headers.get('X-CSRF-Token') ?? '';
  if (!provided || provided !== actor.csrf) throw new AdminAuthError(403, 'csrf_failed');
}

export async function revokeSession(db: D1Database, request: Request): Promise<void> {
  const token = cookie(request, OPS_COOKIE);
  if (!token) return;
  const tokenHash = await hashToken(token);
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function rateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMinutes: number,
  blockMinutes: number,
): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare('SELECT attempts, window_started_at, blocked_until FROM admin_rate_limits WHERE scope_key = ?')
    .bind(key)
    .first<{ attempts: number; window_started_at: string; blocked_until: string | null }>();
  if (row?.blocked_until && Date.parse(row.blocked_until) > now) return false;
  const windowStart = row ? Date.parse(row.window_started_at) : 0;
  const attempts = !row || now - windowStart > windowMinutes * 60_000 ? 1 : Number(row.attempts) + 1;
  const startedAt = !row || now - windowStart > windowMinutes * 60_000 ? new Date(now).toISOString() : row.window_started_at;
  const blockedUntil =
    attempts > limit ? new Date(now + blockMinutes * 60_000).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO admin_rate_limits (scope_key, attempts, window_started_at, blocked_until, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         attempts = excluded.attempts,
         window_started_at = excluded.window_started_at,
         blocked_until = excluded.blocked_until,
         updated_at = excluded.updated_at`,
    )
    .bind(key, attempts, startedAt, blockedUntil, new Date(now).toISOString())
    .run();
  return attempts <= limit;
}

export async function audit(
  db: D1Database,
  input: {
    actorUserId: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    success?: boolean;
    detail?: string;
    ipHash?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_audit
       (id, actor_user_id, action, entity_type, entity_id, success, detail_json, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `audit_${crypto.randomUUID()}`,
      input.actorUserId,
      input.action,
      input.entityType ?? '',
      input.entityId ?? '',
      input.success === false ? 0 : 1,
      JSON.stringify({ detail: input.detail ?? '' }),
      input.ipHash ?? null,
    )
    .run();
}

export async function auditFromRequest(
  db: D1Database,
  request: Request,
  actor: AdminActor | null,
  action: string,
  detail = '',
): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  await audit(db, {
    actorUserId: actor?.id ?? null,
    action,
    detail,
    ipHash: ip ? await hashToken(ip) : null,
    success: true,
  }).catch(() => undefined);
}
