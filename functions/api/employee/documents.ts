// Authenticated employee onboarding documents. The employee may only obtain a
// signing link for their own linked roster profile.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor } from '../../../src/lib/admin/operations.ts';
import { employeeProfile, employeeRoleAllowed } from '../../../src/lib/employee/server.ts';
import {
  createSigningRequest,
  employeeOnboardingStatus,
  rotateSigningRequestToken,
} from '../../../src/lib/documents/service.ts';

interface Env extends AdminDbEnv {}

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
    if (!employeeRoleAllowed(actor)) return json({ ok: false, error: 'forbidden' }, 403);
    const profile = await employeeProfile(db, actor.id);
    if (!profile) return json({ ok: false, error: 'employee_profile_missing' }, 403);
    const role = profile.isSolo ? 'solo' : profile.isLead ? 'lead' : 'helper';
    const status = await employeeOnboardingStatus(db, profile.teamMemberId, role);
    if (status.satisfied) {
      return json({ ok: true, required: false, satisfied: true, missing: [] });
    }
    const pending = await db
      .prepare(
        `SELECT id FROM signing_requests
         WHERE team_member_id = ? AND subject_type = 'employee'
           AND status IN ('pending','partially_signed')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(profile.teamMemberId)
      .first<{ id: string }>();
    let token = '';
    if (pending) {
      token = (await rotateSigningRequestToken(db, null, pending.id)).token;
    } else {
      const created = await createSigningRequest(db, {
        subjectType: 'employee',
        teamMemberId: profile.teamMemberId,
        role,
      });
      token = created.token ?? '';
    }
    return json({
      ok: true,
      required: true,
      satisfied: false,
      missing: status.missing,
      signingUrl: token ? `/document-sign/?token=${encodeURIComponent(token)}&return=/employee/` : '',
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'employee_documents_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
