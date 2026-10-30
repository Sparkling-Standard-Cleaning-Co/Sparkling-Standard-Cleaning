import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { verifyPassword } from '../../../src/lib/admin/auth.ts';
import {
  changePassword,
  getSettings,
  inviteAdmin,
  issuePasswordReset,
  listAdmins,
  listAudit,
  listSessions,
  revokeAllUserSessions,
  revokeOtherSessions,
  setSetting,
  updateAdminRole,
  updateAdminStatus,
} from '../../../src/lib/admin/accounts.ts';
import { disableMfa, enableMfa, startMfaEnrollment, verifyTotp } from '../../../src/lib/admin/mfa.ts';
import { decryptMfaSecret, mfaKeyConfigured } from '../../../src/lib/admin/secrets.ts';
import {
  buildOpsInvitationEmail,
  buildOpsPasswordChangedEmail,
  buildOpsPasswordResetEmail,
  sendAdminEmail,
} from '../../../src/lib/admin/email.ts';

interface Env extends AdminDbEnv {
  MFA_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
}

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
    const actor = await requireActor(db, context.request);
    const url = new URL(context.request.url);
    const view = url.searchParams.get('view') ?? 'admins';
    if (view === 'sessions') {
      return json({ ok: true, sessions: await listSessions(db, context.request, actor) });
    }
    if (view === 'roles' || view === 'branches') {
      await requireActor(db, context.request, 'admin.manage');
      if (view === 'roles') {
        const rows = await db.prepare('SELECT id, name, description FROM admin_roles ORDER BY name').all();
        return json({ ok: true, roles: rows.results ?? [] });
      }
      const rows = await db.prepare('SELECT id, name, city, state, status FROM branches ORDER BY name').all();
      return json({ ok: true, branches: rows.results ?? [] });
    }
    await requireActor(db, context.request, 'admin.manage');
    if (view === 'audit') {
      return json({ ok: true, audit: await listAudit(db, actor, Number(url.searchParams.get('limit') ?? 100)) });
    }
    if (view === 'settings') {
      return json({ ok: true, settings: await getSettings(db) });
    }
    return json({ ok: true, admins: await listAdmins(db) });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'account_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (
      action === 'mfa_setup' ||
      action === 'mfa_enable' ||
      action === 'mfa_disable' ||
      action === 'revoke_others' ||
      action === 'change_password'
    ) {
      const actor = await requireActor(db, context.request);
      requireCsrf(context.request, actor);
      if (action === 'revoke_others') {
        await revokeOtherSessions(db, context.request, actor);
        return json({ ok: true });
      }
      if (action === 'change_password') {
        await changePassword(db, actor, {
          currentPassword: String(body.currentPassword ?? ''),
          newPassword: String(body.newPassword ?? ''),
        });
        await revokeOtherSessions(db, context.request, actor);
        const site = context.env.PUBLIC_SITE_URL?.trim() || new URL(context.request.url).origin;
        await sendAdminEmail(
          {
            ...(context.env.RESEND_API_KEY ? { RESEND_API_KEY: context.env.RESEND_API_KEY } : {}),
            ...(context.env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: context.env.RESEND_FROM_EMAIL } : {}),
            PUBLIC_SITE_URL: site,
          },
          actor.email,
          buildOpsPasswordChangedEmail({ PUBLIC_SITE_URL: site }, actor.name),
          `ops-password-changed-${actor.id}-${Date.now()}`,
        );
        return json({ ok: true });
      }
      if (action === 'mfa_setup') {
        if (actor.mfaEnabled) return json({ ok: false, error: 'mfa_already_enabled' }, 409);
        if (!mfaKeyConfigured(context.env.MFA_ENCRYPTION_KEY)) {
          return json({ ok: false, error: 'mfa_encryption_not_configured' }, 503);
        }
        const enrollment = await startMfaEnrollment(db, actor.id, actor.email, context.env.MFA_ENCRYPTION_KEY);
        await audit(db, { actorUserId: actor.id, action: 'admin.mfa_setup_started' });
        return json({ ok: true, ...enrollment });
      }
      if (action === 'mfa_enable') {
        const codes = await enableMfa(db, actor.id, String(body.code ?? ''), context.env.MFA_ENCRYPTION_KEY);
        if (!codes) return json({ ok: false, error: 'mfa_code_invalid' }, 401);
        await audit(db, { actorUserId: actor.id, action: 'admin.mfa_enabled' });
        return json({ ok: true, recoveryCodes: codes });
      }
      const password = String(body.password ?? '');
      const code = String(body.code ?? '');
      const stored = await db.prepare('SELECT password_hash, mfa_secret FROM admin_users WHERE id = ?').bind(actor.id).first<{ password_hash: string; mfa_secret: string | null }>();
      if (!stored || !(await verifyPassword(password, stored.password_hash))) {
        return json({ ok: false, error: 'password_invalid' }, 401);
      }
      if (!stored.mfa_secret) return json({ ok: false, error: 'mfa_not_enabled' }, 400);
      const secret = await decryptMfaSecret(stored.mfa_secret, context.env.MFA_ENCRYPTION_KEY);
      if (!secret || !(await verifyTotp(secret, code))) return json({ ok: false, error: 'mfa_code_invalid' }, 401);
      await disableMfa(db, actor.id);
      await audit(db, { actorUserId: actor.id, action: 'admin.mfa_disabled' });
      return json({ ok: true });
    }

    const actor = await requireActor(db, context.request, 'admin.manage');
    requireCsrf(context.request, actor);
    if (action === 'invite') {
      const result = await inviteAdmin(db, actor, body);
      const origin = context.env.PUBLIC_SITE_URL?.trim() || new URL(context.request.url).origin;
      const emailSent = await sendAdminEmail(
        {
          ...(context.env.RESEND_API_KEY ? { RESEND_API_KEY: context.env.RESEND_API_KEY } : {}),
          ...(context.env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: context.env.RESEND_FROM_EMAIL } : {}),
          PUBLIC_SITE_URL: origin,
        },
        String(body.email ?? ''),
        buildOpsInvitationEmail({ PUBLIC_SITE_URL: origin }, result.token, String(body.role ?? 'administrator')),
        `ops-invite-${result.token.slice(0, 16)}`,
      );
      return json({ ok: true, ...result, emailSent });
    }
    if (action === 'issue_reset') {
      const result = await issuePasswordReset(db, actor, String(body.userId ?? ''));
      const origin = context.env.PUBLIC_SITE_URL?.trim() || new URL(context.request.url).origin;
      const emailSent = await sendAdminEmail(
        {
          ...(context.env.RESEND_API_KEY ? { RESEND_API_KEY: context.env.RESEND_API_KEY } : {}),
          ...(context.env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: context.env.RESEND_FROM_EMAIL } : {}),
          PUBLIC_SITE_URL: origin,
        },
        result.email,
        buildOpsPasswordResetEmail({ PUBLIC_SITE_URL: origin }, result.token),
        `ops-reset-${result.token.slice(0, 16)}`,
      );
      return json({ ok: true, ...result, emailSent });
    }
    if (action === 'status') {
      await updateAdminStatus(db, actor, String(body.userId ?? ''), String(body.status ?? ''));
      return json({ ok: true });
    }
    if (action === 'role') {
      await updateAdminRole(
        db,
        actor,
        String(body.userId ?? ''),
        String(body.role ?? ''),
        String(body.branchId ?? '') || null,
      );
      return json({ ok: true });
    }
    if (action === 'revoke_user') {
      await revokeAllUserSessions(db, actor, String(body.userId ?? ''));
      return json({ ok: true });
    }
    if (action === 'setting') {
      await requireActor(db, context.request, 'settings.write');
      const key = String(body.key ?? '');
      await setSetting(db, actor, key, body.value ?? null);
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'account_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
