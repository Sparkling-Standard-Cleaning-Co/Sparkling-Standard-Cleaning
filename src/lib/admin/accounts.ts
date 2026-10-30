import { hashPassword, hashToken, passwordProblem, randomToken } from './auth.ts';
import { AdminAuthError, audit, cookie, OPS_COOKIE, type AdminActor } from './operations.ts';
import type { D1Database } from './d1.ts';

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function listAdmins(db: D1Database): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role_id, u.branch_id, u.status,
              u.mfa_enabled, u.last_login_at, u.created_at, b.name AS branch_name
       FROM admin_users u LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY u.created_at`,
    )
    .all();
  return result.results ?? [];
}

export async function inviteAdmin(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ token: string; expiresAt: string }> {
  const email = text(input.email, 200).toLowerCase();
  const role = text(input.role, 30);
  const branchId = text(input.branchId, 80) || null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new AdminAuthError(400, 'email_invalid');
  const roleRow = await db.prepare('SELECT id FROM admin_roles WHERE id = ?').bind(role).first();
  if (!roleRow) throw new AdminAuthError(400, 'role_invalid');
  if (branchId) {
    const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND status = 'active'").bind(branchId).first();
    if (!branch) throw new AdminAuthError(400, 'branch_invalid');
  }
  const existing = await db.prepare('SELECT id FROM admin_users WHERE email = ? LIMIT 1').bind(email).first();
  if (existing) throw new AdminAuthError(409, 'admin_exists');
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO admin_invitations
       (id, email, role_id, branch_id, token_hash, expires_at, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `invite_${crypto.randomUUID()}`,
      email,
      role,
      branchId,
      await hashToken(token),
      expiresAt,
      actor.id,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'admin.invited',
    entityType: 'admin_invitation',
    entityId: email,
    detail: role,
  });
  return { token, expiresAt };
}

export async function acceptInvite(
  db: D1Database,
  input: { token: string; password: string; name?: string },
): Promise<{ id: string; email: string; role: string }> {
  const token = text(input.token, 300);
  const password = text(input.password, 200);
  if (!token) throw new AdminAuthError(400, 'invite_required');
  const problem = passwordProblem(password);
  if (problem) throw new AdminAuthError(400, problem);
  const row = await db
    .prepare(
      `SELECT id, email, role_id, branch_id, expires_at, accepted_at
       FROM admin_invitations WHERE token_hash = ? LIMIT 1`,
    )
    .bind(await hashToken(token))
    .first<{
      id: string;
      email: string;
      role_id: string;
      branch_id: string | null;
      expires_at: string;
      accepted_at: string | null;
    }>();
  if (!row || row.accepted_at || Date.parse(row.expires_at) <= Date.now()) {
    throw new AdminAuthError(400, 'invite_invalid');
  }
  const existing = await db.prepare('SELECT id FROM admin_users WHERE email = ? LIMIT 1').bind(row.email).first();
  if (existing) throw new AdminAuthError(409, 'admin_exists');
  const id = `admin_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO admin_users (id, branch_id, role_id, email, password_hash, display_name, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    )
    .bind(
      id,
      row.branch_id,
      row.role_id,
      row.email,
      await hashPassword(password),
      text(input.name, 120) || row.email.split('@')[0] || 'Administrator',
    )
    .run();
  await db
    .prepare('UPDATE admin_invitations SET accepted_at = ? WHERE id = ?')
    .bind(now(), row.id)
    .run();
  await audit(db, {
    actorUserId: id,
    action: 'admin.invite_accepted',
    entityType: 'admin_user',
    entityId: id,
  });
  return { id, email: row.email, role: row.role_id };
}

export async function issuePasswordReset(
  db: D1Database,
  actor: AdminActor,
  userId: string,
): Promise<{ token: string; expiresAt: string; email: string }> {
  const user = await db
    .prepare('SELECT id, email FROM admin_users WHERE id = ? AND status = ? LIMIT 1')
    .bind(userId, 'active')
    .first<{ id: string; email: string }>();
  if (!user) throw new AdminAuthError(404, 'admin_not_found');
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO admin_password_resets
       (id, user_id, token_hash, expires_at, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(`reset_${crypto.randomUUID()}`, user.id, await hashToken(token), expiresAt, actor.id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'admin.password_reset_issued',
    entityType: 'admin_user',
    entityId: user.id,
  });
  return { token, expiresAt, email: user.email };
}

export async function resetPassword(
  db: D1Database,
  input: { token: string; password: string },
): Promise<void> {
  const problem = passwordProblem(text(input.password, 200));
  if (problem) throw new AdminAuthError(400, problem);
  const token = text(input.token, 300);
  const row = await db
    .prepare(
      `SELECT id, user_id, expires_at, used_at FROM admin_password_resets
       WHERE token_hash = ? LIMIT 1`,
    )
    .bind(await hashToken(token))
    .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) {
    throw new AdminAuthError(400, 'reset_invalid');
  }
  await db
    .prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(text(input.password, 200)), now(), row.user_id)
    .run();
  await db.prepare('UPDATE admin_password_resets SET used_at = ? WHERE id = ?').bind(now(), row.id).run();
  await db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(row.user_id).run();
  await audit(db, {
    actorUserId: row.user_id,
    action: 'admin.password_reset_completed',
    entityType: 'admin_user',
    entityId: row.user_id,
  });
}

export async function listAudit(
  db: D1Database,
  actor: AdminActor,
  limit = 100,
): Promise<Array<Record<string, unknown>>> {
  const bounded = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const result = await db
    .prepare(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.success, a.detail_json,
              a.created_at, u.display_name
       FROM admin_audit a LEFT JOIN admin_users u ON u.id = a.actor_user_id
       WHERE (? = 'owner' OR a.branch_id = ? OR a.branch_id IS NULL)
       ORDER BY a.created_at DESC LIMIT ?`,
    )
    .bind(actor.role, actor.branchId, bounded)
    .all();
  return result.results ?? [];
}

export async function listSessions(
  db: D1Database,
  request: Request,
  actor: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const current = cookie(request, OPS_COOKIE);
  const currentHash = current ? await hashToken(current) : '';
  const result = await db
    .prepare(
      `SELECT id, created_at, expires_at, revoked_at,
              CASE WHEN token_hash = ? THEN 1 ELSE 0 END AS current
       FROM admin_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
    )
    .bind(currentHash, actor.id)
    .all();
  return result.results ?? [];
}

export async function revokeOtherSessions(
  db: D1Database,
  request: Request,
  actor: AdminActor,
): Promise<void> {
  const current = cookie(request, OPS_COOKIE);
  const currentHash = current ? await hashToken(current) : '';
  await db
    .prepare('DELETE FROM admin_sessions WHERE user_id = ? AND token_hash <> ?')
    .bind(actor.id, currentHash)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'admin.sessions_revoked',
    detail: 'all other sessions',
  });
}

export async function revokeAllUserSessions(
  db: D1Database,
  actor: AdminActor,
  userId: string,
): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(userId).run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'admin.user_sessions_revoked',
    entityType: 'admin_user',
    entityId: userId,
  });
}

export async function updateAdminStatus(
  db: D1Database,
  actor: AdminActor,
  userId: string,
  status: string,
): Promise<void> {
  if (status !== 'active' && status !== 'disabled') throw new AdminAuthError(400, 'status_invalid');
  if (userId === actor.id && status === 'disabled') throw new AdminAuthError(400, 'cannot_disable_self');
  const target = await db.prepare('SELECT role_id FROM admin_users WHERE id = ? LIMIT 1').bind(userId).first<{ role_id: string }>();
  if (!target) throw new AdminAuthError(404, 'admin_not_found');
  if (status === 'disabled' && target.role_id === 'owner') {
    const owners = await db
      .prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role_id = 'owner' AND status = 'active'")
      .first<{ count: number }>();
    if (Number(owners?.count ?? 0) <= 1) throw new AdminAuthError(409, 'last_owner');
  }
  const result = await db
    .prepare('UPDATE admin_users SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now(), userId)
    .run();
  if (!result.success) throw new AdminAuthError(400, 'admin_update_failed');
  if (status === 'disabled') await db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(userId).run();
  await audit(db, {
    actorUserId: actor.id,
    action: status === 'active' ? 'admin.enabled' : 'admin.disabled',
    entityType: 'admin_user',
    entityId: userId,
  });
}

export async function updateAdminRole(
  db: D1Database,
  actor: AdminActor,
  userId: string,
  role: string,
  branchId: string | null,
): Promise<void> {
  const roleRow = await db.prepare('SELECT id FROM admin_roles WHERE id = ?').bind(role).first();
  if (!roleRow) throw new AdminAuthError(400, 'role_invalid');
  if (branchId) {
    const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND status = 'active'").bind(branchId).first();
    if (!branch) throw new AdminAuthError(400, 'branch_invalid');
  }
  const target = await db.prepare('SELECT role_id FROM admin_users WHERE id = ? LIMIT 1').bind(userId).first<{ role_id: string }>();
  if (!target) throw new AdminAuthError(404, 'admin_not_found');
  if (target.role_id === 'owner' && role !== 'owner') {
    const owners = await db
      .prepare("SELECT COUNT(*) AS count FROM admin_users WHERE role_id = 'owner' AND status = 'active'")
      .first<{ count: number }>();
    if (Number(owners?.count ?? 0) <= 1) throw new AdminAuthError(409, 'last_owner');
  }
  if (userId === actor.id && role !== 'owner') throw new AdminAuthError(400, 'cannot_demote_self');
  await db
    .prepare('UPDATE admin_users SET role_id = ?, branch_id = ?, updated_at = ? WHERE id = ?')
    .bind(role, branchId, now(), userId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'admin.role_updated',
    entityType: 'admin_user',
    entityId: userId,
    detail: `${role}:${branchId ?? 'global'}`,
  });
}

export async function getSettings(db: D1Database): Promise<Record<string, unknown>> {
  const rows = await db.prepare('SELECT key, value_json FROM admin_settings ORDER BY key').all<{
    key: string;
    value_json: string;
  }>();
  const result: Record<string, unknown> = {};
  for (const row of rows.results ?? []) {
    try {
      result[row.key] = JSON.parse(row.value_json);
    } catch {
      result[row.key] = row.value_json;
    }
  }
  return result;
}

export async function setSetting(
  db: D1Database,
  actor: AdminActor,
  keyInput: string,
  value: unknown,
): Promise<void> {
  const key = text(keyInput, 80);
  if (!/^[a-z0-9_.-]+$/.test(key)) throw new AdminAuthError(400, 'setting_key_invalid');
  await db
    .prepare(
      `INSERT INTO admin_settings (key, value_json, updated_by_admin_user_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_by_admin_user_id = excluded.updated_by_admin_user_id,
         updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), actor.id, now())
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'settings.updated',
    entityType: 'setting',
    entityId: key,
  });
}
