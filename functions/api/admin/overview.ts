import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, type AdminActor } from '../../../src/lib/admin/operations.ts';

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
    const today = now.slice(0, 10);
    const [customers, leads, requests, appointments, gifts, failedLeads, recent, failedCommitments, financialIssues, failedNotifications, failedPaymentEvents, failedWorkerRuns] = await Promise.all([
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
    ]);
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
