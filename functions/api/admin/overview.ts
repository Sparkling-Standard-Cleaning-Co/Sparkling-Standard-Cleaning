import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, type AdminActor } from '../../../src/lib/admin/operations.ts';
import { bookingConfig } from '../../../src/config/booking.ts';
import { zonedTimeToUtc } from '../../../src/lib/booking/time.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function scope(actor: AdminActor, column: string): { where: string; bind: unknown[] } {
  if (actor.role === 'owner') return { where: '', bind: [] };
  if (actor.branchId) return { where: ' AND ' + column + ' = ?', bind: [actor.branchId] };
  return { where: ' AND 1 = 0', bind: [] };
}

async function count(db: D1Database, sql: string, bind: unknown[] = []): Promise<number> {
  const row = await db.prepare(sql).bind(...bind).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'lead.read');
    const customerScope = scope(actor, 'primary_branch_id');
    const leadScope = scope(actor, 'branch_id');
    const requestScope = scope(actor, 'branch_id');
    const appointmentScope = scope(actor, 'branch_id');
    const giftScope = scope(actor, 'branch_id');
    const now = new Date().toISOString();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: bookingConfig.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const todayStart = zonedTimeToUtc(today, '00:00', bookingConfig.timeZone);
    const tomorrowStart = zonedTimeToUtc(tomorrow, '00:00', bookingConfig.timeZone);
    const dayAfterTomorrow = new Date(Date.parse(`${tomorrow}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const dayAfterStart = zonedTimeToUtc(dayAfterTomorrow, '00:00', bookingConfig.timeZone);
    const [customers, leads, requests, appointments, gifts, failedLeads, recent, failedCommitments, financialIssues, failedNotifications, failedPaymentEvents, failedWorkerRuns, todayJobs, tomorrowJobs, unassignedJobs, unsignedAgreements, outstandingInvoices, failedCommunications] = await Promise.all([
      count(db, "SELECT COUNT(*) AS count FROM customers WHERE status = 'active'" + customerScope.where, customerScope.bind),
      count(db, "SELECT COUNT(*) AS count FROM leads WHERE status IN ('new','contacted')" + leadScope.where, leadScope.bind),
      count(db, "SELECT COUNT(*) AS count FROM booking_requests WHERE status = 'pending'" + requestScope.where, requestScope.bind),
      count(
        db,
        "SELECT COUNT(*) AS count FROM appointments WHERE status IN ('pending','confirmed') AND start_at >= ?" + appointmentScope.where,
        [now, ...appointmentScope.bind],
      ),
      count(db, "SELECT COUNT(*) AS count FROM gift_certificates WHERE status = 'active'" + giftScope.where, giftScope.bind),
      count(db, "SELECT COUNT(*) AS count FROM leads WHERE delivery_status = 'failed'" + leadScope.where, leadScope.bind),
      db
        .prepare(
          `SELECT l.id, l.request_type, l.status, l.source, l.quote_reference, l.created_at,
                  c.first_name, c.last_name,
                  (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'email' LIMIT 1) AS email
           FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
           WHERE 1 = 1${leadScope.where.replace('branch_id', 'l.branch_id')}
           ORDER BY l.created_at DESC LIMIT 8`,
        )
        .bind(...leadScope.bind)
        .all(),
      count(
        db,
        "SELECT COUNT(*) AS count FROM booking_commitments WHERE state IN ('failed','calendar_created') OR (state = 'pending' AND updated_at < datetime('now','-10 minutes'))",
      ),
      count(db, 'SELECT COUNT(*) AS count FROM payment_reconciliation_issues'),
      count(db, "SELECT COUNT(*) AS count FROM booking_notifications WHERE status = 'failed'"),
      count(db, "SELECT COUNT(*) AS count FROM payment_events WHERE status IN ('failed','incomplete')"),
      count(db, "SELECT COUNT(*) AS count FROM recurring_worker_runs WHERE status = 'failed'"),
      count(
        db,
        `SELECT COUNT(*) AS count FROM appointments
         WHERE status IN ('pending','confirmed') AND start_at >= ? AND start_at < ?${appointmentScope.where}`,
        [todayStart.toISOString(), tomorrowStart.toISOString(), ...appointmentScope.bind],
      ),
      count(
        db,
        `SELECT COUNT(*) AS count FROM appointments
         WHERE status IN ('pending','confirmed') AND start_at >= ? AND start_at < ?${appointmentScope.where}`,
        [tomorrowStart.toISOString(), dayAfterStart.toISOString(), ...appointmentScope.bind],
      ),
      count(
        db,
        `SELECT COUNT(*) AS count FROM appointments a
         WHERE a.status IN ('pending','confirmed') AND a.start_at >= ?
           AND NOT EXISTS (SELECT 1 FROM appointment_resources r WHERE r.appointment_id = a.id)${appointmentScope.where.replace('branch_id', 'a.branch_id')}`,
        [now, ...appointmentScope.bind],
      ),
      count(
        db,
        "SELECT COUNT(*) AS count FROM signing_requests WHERE status IN ('pending','partially_signed')" + scope(actor, 'branch_id').where,
        scope(actor, 'branch_id').bind,
      ),
      count(
        db,
        "SELECT COUNT(*) AS count FROM invoices WHERE balance_cents > 0 AND status IN ('open','partially_paid','overdue')" + scope(actor, 'branch_id').where,
        scope(actor, 'branch_id').bind,
      ),
      count(
        db,
        `SELECT COUNT(*) AS count FROM (
           SELECT id FROM booking_notifications WHERE status = 'failed'
           UNION ALL SELECT id FROM leads WHERE delivery_status = 'failed'
           UNION ALL SELECT id FROM payment_events WHERE status IN ('failed','incomplete')
         )`,
      ),
    ]);
    const failedCheckouts = await count(
      db,
      "SELECT COUNT(*) AS count FROM checkout_sessions WHERE status = 'failed' OR (status = 'open' AND created_at < datetime('now','-35 minutes'))",
    );
    const ownerMfaMissing = await count(
      db,
      "SELECT COUNT(*) AS count FROM admin_users WHERE role_id = 'owner' AND status = 'active' AND mfa_enabled = 0",
    );
    return json({
      ok: true,
      actor: { name: actor.name, role: actor.role, branchId: actor.branchId },
      counts: {
        customers,
        leads,
        requests,
        upcomingAppointments: appointments,
        activeGifts: gifts,
        failedLeadDeliveries: failedLeads,
        failedCommitments,
        financialIssues,
        failedNotifications,
        failedPaymentEvents,
        failedWorkerRuns,
        todayJobs,
        tomorrowJobs,
        unassignedJobs,
        unsignedAgreements,
        outstandingInvoices,
        failedCommunications,
        failedCheckouts,
        ownerMfaMissing,
      },
      alerts: [
        ...(failedCommitments > 0
          ? [{ kind: 'booking_recovery', severity: 'high', message: `${failedCommitments} booking commitment(s) need reconciliation.`, view: 'new-booking' }]
          : []),
        ...(financialIssues > 0
          ? [{ kind: 'financial_reconciliation', severity: 'high', message: `${financialIssues} financial reconciliation issue(s) are open.`, view: 'finance' }]
          : []),
        ...(failedNotifications > 0
          ? [{ kind: 'booking_notification', severity: 'medium', message: `${failedNotifications} booking email(s) failed to send.`, view: 'calendar' }]
          : []),
        ...(failedPaymentEvents > 0
          ? [{ kind: 'payment_event', severity: 'high', message: `${failedPaymentEvents} payment event(s) failed or are incomplete.`, view: 'finance' }]
          : []),
        ...(failedWorkerRuns > 0
          ? [{ kind: 'recurring_worker', severity: 'high', message: `${failedWorkerRuns} recurring worker run(s) failed.`, view: 'recurring' }]
          : []),
        ...(failedLeads > 0
          ? [{ kind: 'lead_delivery', severity: 'medium', message: `${failedLeads} lead notification(s) failed delivery.`, view: 'leads' }]
          : []),
        ...(unsignedAgreements > 0
          ? [{ kind: 'unsigned_agreements', severity: 'medium', message: `${unsignedAgreements} agreement packet(s) are waiting for signature.`, view: 'documents' }]
          : []),
        ...(outstandingInvoices > 0
          ? [{ kind: 'outstanding_invoices', severity: 'medium', message: `${outstandingInvoices} invoice(s) have an outstanding balance.`, view: 'finance' }]
          : []),
        ...(ownerMfaMissing > 0
          ? [{ kind: 'security_mfa', severity: 'high', message: 'An active owner account does not have two-step verification enabled.', view: 'settings' }]
          : []),
        ...(failedCheckouts > 0
          ? [{ kind: 'checkout_failure', severity: 'high', message: `${failedCheckouts} checkout session(s) failed or are stale.`, view: 'calendar' }]
          : []),
        ...(unassignedJobs > 0
          ? [{ kind: 'unassigned_jobs', severity: 'medium', message: `${unassignedJobs} upcoming job(s) have no assigned cleaner.`, view: 'jobs' }]
          : []),
      ],
      today,
      recentLeads: recent.results ?? [],
    });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 500;
    const code = error instanceof AdminAuthError ? error.code : 'overview_failed';
    return json({ ok: false, error: code }, status);
  }
}
