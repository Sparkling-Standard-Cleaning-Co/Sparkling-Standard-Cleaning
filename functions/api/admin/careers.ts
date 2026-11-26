// Recruitment administration. Applicant records, resumes and hiring notes are
// private to authorized owner/manager staff and scoped to the manager's branch.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  DEPARTMENT_ADDRESSES,
  readCommunicationSettings,
  recordNotificationDelivery,
} from '../../../src/lib/admin/communications.ts';
import { EMAIL_ROUTING } from '../../../src/config/email-routing.ts';
import { CAREER_PIPELINE_STATUSES } from '../../../src/lib/careers.ts';

interface R2Object { body: ReadableStream; httpMetadata?: { contentType?: string } }
interface R2Bucket { get(key: string): Promise<R2Object | null> }
interface Env extends AdminDbEnv {
  DOCUMENTS_BUCKET?: R2Bucket;
  PHOTOS_BUCKET?: R2Bucket;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

const LEGACY_STATUS: Record<string, string> = {
  new: 'new',
  under_review: 'reviewing',
  interview_requested: 'interview',
  interview_scheduled: 'interview',
  interview_completed: 'interview',
  selected: 'offer',
  onboarding: 'offer',
  hired: 'offer',
  not_selected: 'declined',
  withdrawn: 'declined',
  archived: 'archived',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function branchScope(actor: { role: string; branchId: string | null }): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (!actor.branchId) return { sql: ' AND 1 = 0', bind: [] };
  return { sql: ' AND (a.branch_id = ? OR a.branch_id IS NULL)', bind: [actor.branchId] };
}

function canManage(actor: { role: string }): boolean {
  return actor.role === 'owner' || actor.role === 'manager';
}

async function applicationFor(
  db: NonNullable<ReturnType<typeof adminDb>>,
  actor: { role: string; branchId: string | null },
  id: string,
): Promise<Record<string, unknown>> {
  const scope = branchScope(actor).sql.replace('a.branch_id', 'branch_id');
  const row = await db
    .prepare(`SELECT * FROM career_applications a WHERE a.id = ?${scope} LIMIT 1`)
    .bind(id, ...(scope ? [actor.branchId] : []))
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'application_not_found');
  return row;
}

async function sendApplicantEmail(
  db: NonNullable<ReturnType<typeof adminDb>>,
  env: Env,
  to: string,
  subject: string,
  message: string,
  applicationId: string,
): Promise<boolean> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return false;
  const communications = await readCommunicationSettings(db);
  const replyTo = DEPARTMENT_ADDRESSES[communications.settings.replyTo.careers] ?? EMAIL_ROUTING.hiring;
  let delivered = false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `career-admin-${applicationId}-${Date.now()}`,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || EMAIL_ROUTING.notificationsSender,
        to: [to],
        reply_to: replyTo,
        subject,
        text: message,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    delivered = response.ok;
  } catch {
    delivered = false;
  }
  await recordNotificationDelivery(db, {
    eventKey: 'careers_application',
    department: communications.settings.replyTo.careers,
    recipient: to,
    status: delivered ? 'sent' : 'failed',
    errorCode: delivered ? '' : 'provider_rejected',
    relatedType: 'career_application',
    relatedId: applicationId,
  }).catch(() => undefined);
  return delivered;
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.read');
    if (!canManage(actor)) return json({ ok: false, error: 'manager_required' }, 403);
    const url = new URL(context.request.url);
    const id = text(url.searchParams.get('id'), 120);
    const view = text(url.searchParams.get('view'), 30) || 'list';
    if (view === 'resume' && id) {
      const row = await applicationFor(db, actor, id);
      const resumeKey = String(row.resume_key ?? '');
      if (!resumeKey) return json({ ok: false, error: 'resume_not_found' }, 404);
      const bucket = context.env.DOCUMENTS_BUCKET ?? context.env.PHOTOS_BUCKET;
      if (!bucket) return json({ ok: false, error: 'resume_storage_not_configured' }, 503);
      const object = await bucket.get(resumeKey);
      if (!object) return json({ ok: false, error: 'resume_not_found' }, 404);
      await audit(db, { actorUserId: actor.id, action: 'careers.resume_downloaded', entityType: 'career_application', entityId: id }).catch(() => undefined);
      const filename = (String(row.resume_name ?? 'resume')).replace(/["\r\n]/g, '');
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || String(row.resume_type ?? 'application/octet-stream'),
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (view === 'options') {
      const branch = actor.role === 'owner' ? text(url.searchParams.get('branch'), 40) : actor.branchId ?? '';
      const [opportunities, settings] = await Promise.all([
        db
          .prepare(
            `SELECT * FROM recruitment_opportunities
             WHERE (? = '' OR branch_id = ?) ORDER BY branch_id, sort_order, title LIMIT 100`,
          )
          .bind(branch, branch)
          .all<Record<string, unknown>>(),
        db
          .prepare(
            `SELECT * FROM recruitment_settings
             WHERE (? = '' OR branch_id = ?) ORDER BY branch_id LIMIT 10`,
          )
          .bind(branch, branch)
          .all<Record<string, unknown>>(),
      ]);
      return json({ ok: true, opportunities: opportunities.results ?? [], settings: settings.results ?? [] });
    }
    if (view === 'detail' && id) {
      const application = await applicationFor(db, actor, id);
      const interviews = await db
        .prepare('SELECT * FROM career_interview_events WHERE application_id = ? ORDER BY created_at DESC LIMIT 50')
        .bind(id)
        .all<Record<string, unknown>>();
      return json({ ok: true, application, interviews: interviews.results ?? [], statuses: CAREER_PIPELINE_STATUSES });
    }
    const status = text(url.searchParams.get('status'), 40);
    const branch = text(url.searchParams.get('branch'), 40);
    const position = text(url.searchParams.get('position'), 40);
    const availability = text(url.searchParams.get('availability'), 20);
    const q = text(url.searchParams.get('q'), 120);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
    const sorts: Record<string, string> = {
      created_at: 'a.created_at DESC, a.id ASC',
      name: 'a.name ASC, a.created_at DESC, a.id ASC',
      status: 'a.pipeline_status ASC, a.created_at DESC, a.id ASC',
    };
    const sortKey = sorts[url.searchParams.get('sort') ?? ''] ? String(url.searchParams.get('sort')) : 'created_at';
    const scope = branchScope(actor);
    const availabilitySql = availability === 'morning'
      ? ' AND a.availability_morning = 1'
      : availability === 'afternoon'
        ? ' AND a.availability_afternoon = 1'
        : availability === 'evening'
          ? ' AND a.availability_evening = 1'
          : availability === 'weekend'
            ? ' AND a.availability_weekend = 1'
            : '';
    const filters = `WHERE (? = '' OR a.pipeline_status = ?)
       AND (? = '' OR a.branch_preference = ?)
       AND (? = '' OR a.position_code = ?)
       AND (? = '' OR a.name LIKE ? OR a.email LIKE ? OR a.reference LIKE ? OR a.city LIKE ?)
       ${availabilitySql}${scope.sql}`;
    const filterBind = [
      status, status,
      branch, branch,
      position, position,
      q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`,
      ...scope.bind,
    ];
    const rows = await db.prepare(
      `SELECT a.id, a.reference, a.created_at, a.name, a.first_name, a.last_name, a.email, a.phone,
              a.city, a.postal_code, a.position_code, a.desired_role, a.branch_preference, a.branch_id,
              a.availability, a.employment_type, a.desired_weekly_hours, a.pipeline_status,
              a.resume_key, a.interview_at, a.follow_up_at, a.converted_team_member_id
       FROM career_applications a ${filters}
       ORDER BY ${sorts[sortKey]} LIMIT ? OFFSET ?`,
    ).bind(...filterBind, limit, offset).all<Record<string, unknown>>();
    const total = await db.prepare(`SELECT COUNT(*) AS count FROM career_applications a ${filters}`)
      .bind(...filterBind).first<{ count: number }>();
    return json({ ok: true, applications: rows.results ?? [], total: Number(total?.count ?? 0), limit, offset, sort: sortKey, statuses: CAREER_PIPELINE_STATUSES });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'careers_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.write');
    requireCsrf(context.request, actor);
    if (!canManage(actor)) return json({ ok: false, error: 'manager_required' }, 403);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    const now = new Date().toISOString();

    if (action === 'update_status') {
      const id = text(body.applicationId, 120);
      const application = await applicationFor(db, actor, id);
      const status = text(body.status, 40);
      if (!CAREER_PIPELINE_STATUSES.some((entry) => entry.value === status)) {
        return json({ ok: false, error: 'status_invalid' }, 400);
      }
      const legacy = LEGACY_STATUS[status] ?? 'new';
      await db
        .prepare(
          `UPDATE career_applications SET pipeline_status = ?, status = ?, notes = ?,
             archived_at = CASE WHEN ? = 'archived' THEN ? ELSE archived_at END,
             hired_at = CASE WHEN ? = 'hired' THEN ? ELSE hired_at END,
             updated_at = ? WHERE id = ?`,
        )
        .bind(status, legacy, text(body.notes, 5000), status, now, status, now, now, id)
        .run();
      await audit(db, { actorUserId: actor.id, action: 'careers.status_updated', entityType: 'career_application', entityId: id, detail: status });
      return json({ ok: true, application: { id: application.id, status } });
    }

    if (action === 'schedule_interview') {
      const id = text(body.applicationId, 120);
      await applicationFor(db, actor, id);
      const scheduledAt = text(body.scheduledAt, 40);
      const interviewer = text(body.interviewer, 160);
      const notes = text(body.notes, 3000);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduledAt)) {
        return json({ ok: false, error: 'interview_time_invalid' }, 400);
      }
      await db.prepare(
        `INSERT INTO career_interview_events (id, application_id, scheduled_at, interviewer, notes, outcome, created_by_admin_user_id)
         VALUES (?, ?, ?, ?, ?, '', ?)`,
      ).bind(`int_${crypto.randomUUID()}`, id, scheduledAt, interviewer, notes, actor.id).run();
      await db.prepare(
        `UPDATE career_applications SET pipeline_status = 'interview_scheduled', status = 'interview',
           interview_at = ?, interview_notes = ?, updated_at = ? WHERE id = ?`,
      ).bind(scheduledAt, notes, now, id).run();
      await audit(db, { actorUserId: actor.id, action: 'careers.interview_scheduled', entityType: 'career_application', entityId: id, detail: scheduledAt });
      return json({ ok: true });
    }

    if (action === 'interview_event') {
      const id = text(body.applicationId, 120);
      await applicationFor(db, actor, id);
      const eventId = `int_${crypto.randomUUID()}`;
      await db.prepare(
        `INSERT INTO career_interview_events (id, application_id, scheduled_at, interviewer, notes, outcome, created_by_admin_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        eventId,
        id,
        text(body.scheduledAt, 40) || null,
        text(body.interviewer, 160),
        text(body.notes, 3000),
        text(body.outcome, 120),
        actor.id,
      ).run();
      await audit(db, { actorUserId: actor.id, action: 'careers.interview_recorded', entityType: 'career_application', entityId: id });
      return json({ ok: true, id: eventId });
    }

    if (action === 'set_follow_up') {
      const id = text(body.applicationId, 120);
      await applicationFor(db, actor, id);
      const followUp = text(body.followUpAt, 40) || null;
      if (followUp && !/^\d{4}-\d{2}-\d{2}/.test(followUp)) {
        return json({ ok: false, error: 'follow_up_invalid' }, 400);
      }
      await db.prepare('UPDATE career_applications SET follow_up_at = ?, updated_at = ? WHERE id = ?')
        .bind(followUp, now, id).run();
      return json({ ok: true });
    }

    if (action === 'email_applicant') {
      const id = text(body.applicationId, 120);
      const application = await applicationFor(db, actor, id);
      const email = String(application.email ?? '').trim().toLowerCase();
      if (!email) return json({ ok: false, error: 'applicant_email_missing' }, 409);
      const template = text(body.template, 40);
      const customSubject = text(body.subject, 160);
      const customMessage = text(body.message, 5000);
      const firstName = String(application.first_name || application.name || 'Applicant').split(' ')[0];
      const templates: Record<string, { subject: string; message: string }> = {
        interview_request: {
          subject: 'Interview request - Sparkling Standard',
          message: `Hello ${firstName},\n\nThank you for your application. We would like to arrange an interview to learn more about your experience and availability.\n\nPlease reply with a few times that work for you.\n\nSparkling Standard | Hiring Team`,
        },
        follow_up: {
          subject: 'Application follow-up - Sparkling Standard',
          message: `Hello ${firstName},\n\nThank you for your continued interest in Sparkling Standard. We are still reviewing applications and will follow up as the hiring process moves forward.\n\nSparkling Standard | Hiring Team`,
        },
        not_selected: {
          subject: 'Application update - Sparkling Standard',
          message: `Hello ${firstName},\n\nThank you for applying to Sparkling Standard. After reviewing the current hiring need, we are not moving forward with your application at this time.\n\nWe appreciate the time you invested and wish you well.\n\nSparkling Standard | Hiring Team`,
        },
        custom: {
          subject: customSubject || 'Application update - Sparkling Standard',
          message: customMessage,
        },
      };
      const selected = templates[template];
      if (!selected || !selected.message.trim()) return json({ ok: false, error: 'email_template_invalid' }, 400);
      const delivered = await sendApplicantEmail(db, context.env, email, selected.subject, selected.message, id);
      await audit(db, { actorUserId: actor.id, action: 'careers.applicant_email', entityType: 'career_application', entityId: id, detail: `${template}:${delivered ? 'sent' : 'failed'}` });
      return delivered ? json({ ok: true, status: 'sent' }) : json({ ok: false, error: 'email_delivery_failed' }, 502);
    }

    if (action === 'convert_to_employee') {
      const id = text(body.applicationId, 120);
      const application = await applicationFor(db, actor, id);
      if (application.converted_team_member_id) {
        return json({ ok: false, error: 'already_converted', teamMemberId: application.converted_team_member_id }, 409);
      }
      const branchId =
        actor.role === 'owner'
          ? (text(body.branchId, 40) || String(application.branch_id ?? 'branch_pensacola'))
          : actor.branchId;
      if (!branchId || !['branch_pensacola', 'branch_tampa'].includes(branchId)) {
        return json({ ok: false, error: 'branch_invalid' }, 400);
      }
      if (actor.role !== 'owner' && String(application.branch_id ?? '') && application.branch_id !== branchId) {
        return json({ ok: false, error: 'branch_scope_denied' }, 403);
      }
      const memberId = `team_${crypto.randomUUID()}`;
      const settings = await db
        .prepare('SELECT pay_regular_cents, pay_lead_cents, pay_solo_cents FROM recruitment_settings WHERE branch_id = ? LIMIT 1')
        .bind(branchId)
        .first<Record<string, unknown>>();
      const displayName = text(application.name, 160) || 'New employee';
      const email = text(application.email, 200).toLowerCase();
      const phone = text(application.phone, 40);
      const rateRegular = Number(settings?.pay_regular_cents ?? 1800);
      const rateLead = Number(settings?.pay_lead_cents ?? 2200);
      const rateSolo = Number(settings?.pay_solo_cents ?? 2500);
      const notes = [
        `Converted from application ${String(application.reference ?? '')}.`,
        application.qualifications ? `Qualifications: ${String(application.qualifications)}` : '',
        application.additional_information ? `Applicant notes: ${String(application.additional_information)}` : '',
      ].filter(Boolean).join('\n').slice(0, 4000);
const memberInsert = db.prepare(
  `INSERT INTO team_members
   (id, branch_id, display_name, email, phone, status, is_bookable,
    pay_rate_regular_cents, pay_rate_lead_cents, pay_rate_solo_cents,
    default_rate_type, hire_date, personnel_notes)
   VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, 'regular', ?, ?)`,
).bind(memberId, branchId, displayName, email, phone, rateRegular, rateLead, rateSolo, now.slice(0, 10), notes);
const applicationUpdate = db.prepare(
  `UPDATE career_applications SET pipeline_status = 'onboarding', status = 'offer',
     converted_team_member_id = ?, hired_at = ?, updated_at = ? WHERE id = ?`,
).bind(memberId, now, now, id);
const batch = db.batch;
if (batch) await batch([memberInsert, applicationUpdate]);
else {
  await memberInsert.run();
  await applicationUpdate.run();
}
      const onboarding = [
        'Complete employment paperwork',
        'Acknowledge the employee handbook',
        'Complete required company training',
        'Review scheduling, timekeeping and job procedures',
      ];
      for (const title of onboarding) {
        await db.prepare(
          `INSERT INTO employee_onboarding_tasks
           (id, team_member_id, title, category, required, status, created_by_admin_user_id)
           VALUES (?, ?, ?, 'onboarding', 1, 'pending', ?)`,
        ).bind(`onb_${crypto.randomUUID()}`, memberId, title, actor.id).run();
      }
      await audit(db, { actorUserId: actor.id, action: 'careers.converted_to_employee', entityType: 'career_application', entityId: id, detail: memberId });
      return json({ ok: true, teamMemberId: memberId });
    }

    if (action === 'update_opportunity') {
      const opportunityId = text(body.id, 120);
      const opportunity = await db
        .prepare('SELECT * FROM recruitment_opportunities WHERE id = ? LIMIT 1')
        .bind(opportunityId)
        .first<Record<string, unknown>>();
      if (!opportunity) return json({ ok: false, error: 'opportunity_not_found' }, 404);
      if (actor.role !== 'owner' && actor.branchId && opportunity.branch_id !== actor.branchId) {
        return json({ ok: false, error: 'branch_scope_denied' }, 403);
      }
      const status = text(body.status, 20);
      if (!['open', 'future', 'closed'].includes(status)) return json({ ok: false, error: 'status_invalid' }, 400);
      await db
        .prepare(
          `UPDATE recruitment_opportunities SET status = ?, title = COALESCE(NULLIF(?, ''), title),
             description = COALESCE(NULLIF(?, ''), description), updated_at = ? WHERE id = ?`,
        )
        .bind(status, text(body.title, 160), text(body.description, 600), now, opportunityId)
        .run();
      await audit(db, { actorUserId: actor.id, action: 'recruitment.opportunity_updated', entityType: 'recruitment_opportunity', entityId: opportunityId, detail: status });
      return json({ ok: true });
    }

    if (action === 'update_pay') {
      const branchId = actor.role === 'owner' ? text(body.branchId, 40) : actor.branchId;
      if (!branchId || !['branch_pensacola', 'branch_tampa'].includes(branchId)) {
        return json({ ok: false, error: 'branch_invalid' }, 400);
      }
      if (actor.role !== 'owner' && actor.branchId !== branchId) {
        return json({ ok: false, error: 'branch_scope_denied' }, 403);
      }
      const rates = ['regular', 'lead', 'solo'].map((key) => Math.round(Number(body[key])));
      if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100_000)) {
        return json({ ok: false, error: 'pay_rate_invalid' }, 400);
      }
      await db.prepare(
        `INSERT INTO recruitment_settings
         (branch_id, pay_regular_cents, pay_lead_cents, pay_solo_cents, updated_by_admin_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(branch_id) DO UPDATE SET
           pay_regular_cents = excluded.pay_regular_cents,
           pay_lead_cents = excluded.pay_lead_cents,
           pay_solo_cents = excluded.pay_solo_cents,
           updated_by_admin_user_id = excluded.updated_by_admin_user_id,
           updated_at = excluded.updated_at`,
      ).bind(branchId, rates[0], rates[1], rates[2], actor.id, now).run();
      await audit(db, { actorUserId: actor.id, action: 'recruitment.pay_updated', entityType: 'recruitment_settings', entityId: branchId });
      return json({ ok: true });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'careers_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}


