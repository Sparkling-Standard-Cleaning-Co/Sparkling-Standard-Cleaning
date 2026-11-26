import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  requireActor,
  requireCsrf,
  type AdminActor,
} from '../../../src/lib/admin/operations.ts';
import { bookingConfig } from '../../../src/config/booking.ts';
import { zonedTimeToUtc } from '../../../src/lib/booking/time.ts';
import { classifyCheckoutSession } from '../../../src/lib/payments/checkout-inspection.ts';
import {
  alertResolutionSuppresses,
  applyAlertAction,
  readAlertStates,
  type OperationalAlertAction,
} from '../../../src/lib/admin/operational-alerts.ts';

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

interface AlertRecord {
  key: string;
  kind: string;
  severity: 'high' | 'medium' | 'low';
  status: string;
  title: string;
  message: string;
  explanation: string;
  rootCause: string;
  recommendation: string;
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
  view: string;
  filter?: string;
  records: Array<{ label: string; detail: string; id?: string }>;
  canRecheck: boolean;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string;
  dismissedAt?: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function classifyCheckout(row: Record<string, unknown>, now: number): { category: string; explanation: string } {
  const result = classifyCheckoutSession(row, now);
  return { category: result.category, explanation: result.explanation };
}

function workerRootCause(detail: string): string {
  if (/auth_failed|authentication/i.test(detail)) return 'Google Calendar authentication failed. The calendar connection must be reauthorized before sync can succeed.';
  if (/calendar_unavailable/i.test(detail)) return 'Google Calendar was temporarily unavailable. The plan was preserved and the occurrence remains pending sync.';
  if (/slot_unavailable/i.test(detail)) return 'No available start time could fit the requested duration on that date. This is a scheduling conflict, not a data-loss failure.';
  if (/sync_failed/i.test(detail)) return 'The recurring sync failed before all occurrences could be written. The plan and existing appointments were preserved.';
  return 'The worker recorded a failed run. Review the run detail for the exact plan, date and reason.';
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
    const [customers, leads, requests, appointments, gifts, failedLeads, recent, failedCommitments, financialIssues, failedNotifications, failedPaymentEvents, failedWorkerRuns, todayJobs, tomorrowJobs, unassignedJobs, staffingPending, staffingRows, unsignedAgreements, outstandingInvoices, failedCommunications] = await Promise.all([
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
      count(
        db,
        "SELECT COUNT(*) AS count FROM recurring_worker_runs WHERE status = 'failed' AND started_at > COALESCE((SELECT MAX(started_at) FROM recurring_worker_runs WHERE status = 'completed'), '')",
      ),
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
        `SELECT COUNT(*) AS count FROM appointments a
         WHERE a.staffing_pending = 1 AND a.status IN ('pending','confirmed') AND a.start_at >= ?${appointmentScope.where.replace('branch_id', 'a.branch_id')}`,
        [now, ...appointmentScope.bind],
      ),
      db
        .prepare(
          `SELECT a.id, a.reference, a.start_at, a.duration_minutes, a.crew_size, a.staffing_reason,
                  c.first_name, c.last_name
           FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id
           WHERE a.staffing_pending = 1 AND a.status IN ('pending','confirmed') AND a.start_at >= ?${appointmentScope.where.replace('branch_id', 'a.branch_id')}
           ORDER BY a.start_at LIMIT 20`,
        )
        .bind(now, ...appointmentScope.bind)
        .all<Record<string, unknown>>()
        .catch(() => ({ results: [] as Array<Record<string, unknown>> })),
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
      "SELECT COUNT(*) AS count FROM checkout_sessions WHERE status = 'failed'",
    );
    const abandonedCheckouts = await count(
      db,
      "SELECT COUNT(*) AS count FROM checkout_sessions WHERE status = 'open' AND created_at < datetime('now','-35 minutes')",
    );
    const failedWorkerRunsHistory = await count(
      db,
      "SELECT COUNT(*) AS count FROM recurring_worker_runs WHERE status = 'failed'",
    );
    const ownerMfaMissing = await count(
      db,
      "SELECT COUNT(*) AS count FROM admin_users WHERE role_id = 'owner' AND status = 'active' AND mfa_enabled = 0",
    );
    const alertKeys = [
      'requests.pending',
      'documents.unsigned',
      'finance.outstanding_invoices',
      'recurring.worker_failures',
      'checkout.sessions',
      'booking.commitments',
      'finance.reconciliation',
      'communications.booking',
      'payments.events',
      'leads.delivery',
      'security.owner_mfa',
      'jobs.unassigned',
      'staffing.pending',
    ];
    const alertStates = await readAlertStates(db, alertKeys);
    const nowMs = Date.now();
    const [
      checkoutRows,
      workerRows,
      unsignedRows,
      invoiceRows,
      pendingRequestRows,
      failedCommitmentRows,
      reconciliationRows,
      failedPaymentRows,
      failedLeadRows,
    ] = await Promise.all([
      db
        .prepare(
          `SELECT id, quote_reference, status, amount_cents, created_at, expires_at, stripe_session_id
           FROM checkout_sessions
           WHERE status = 'failed' OR (status = 'open' AND created_at < datetime('now','-35 minutes'))
           ORDER BY created_at DESC LIMIT 200`,
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT run_key, status, started_at, finished_at, errors, detail_json
           FROM recurring_worker_runs
           WHERE status = 'failed'
             AND started_at > COALESCE((SELECT MAX(started_at) FROM recurring_worker_runs WHERE status = 'completed'), '')
           ORDER BY started_at DESC LIMIT 50`,
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, bundle_code, packet_name, signer_email, status, created_at
           FROM signing_requests WHERE status IN ('pending','partially_signed')
           ORDER BY created_at DESC LIMIT 50`,
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, number, balance_cents, due_date, created_at, customer_id
           FROM invoices WHERE balance_cents > 0 AND status IN ('open','partially_paid','overdue')
           ORDER BY created_at DESC LIMIT 50`,
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT r.id, r.quote_reference, r.created_at, r.start_at, r.payment_status,
                  c.first_name, c.last_name
           FROM booking_requests r LEFT JOIN customers c ON c.id = r.customer_id
           WHERE r.status = 'pending' AND r.archived_at IS NULL AND r.closed_at IS NULL
           ORDER BY r.created_at DESC LIMIT 50`,
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, state, updated_at FROM booking_commitments
           WHERE state IN ('failed','calendar_created') OR (state = 'pending' AND updated_at < datetime('now','-10 minutes'))
           ORDER BY updated_at DESC LIMIT 50`,
        )
        .all<Record<string, unknown>>(),
      db
        .prepare('SELECT id, created_at, issue_type FROM payment_reconciliation_issues ORDER BY created_at DESC LIMIT 50')
        .all<Record<string, unknown>>()
        .catch(() => ({ results: [] as Array<Record<string, unknown>> })),
      db
        .prepare(
          "SELECT id, status, created_at FROM payment_events WHERE status IN ('failed','incomplete') ORDER BY created_at DESC LIMIT 50",
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(
          "SELECT id, delivery_status, created_at, quote_reference FROM leads WHERE delivery_status = 'failed' ORDER BY created_at DESC LIMIT 50",
        )
        .all<Record<string, unknown>>(),
    ]);

    const checkoutCategories = new Map<string, number>();
    for (const row of checkoutRows.results ?? []) {
      const classification = classifyCheckout(row, nowMs);
      checkoutCategories.set(
        classification.category,
        (checkoutCategories.get(classification.category) ?? 0) + 1,
      );
    }
    const checkoutRootCause = [...checkoutCategories.entries()]
      .map(([category, amount]) => `${amount} ${category.toLowerCase()}`)
      .join('; ') || 'No checkout sessions are currently flagged.';
    const checkoutRecords = (checkoutRows.results ?? []).slice(0, 8).map((row) => {
      const classification = classifyCheckout(row, nowMs);
      return {
        label: String(row.quote_reference ?? row.id ?? 'Checkout session'),
        detail: `${classification.category} · ${new Date(String(row.created_at)).toLocaleString('en-US', { timeZone: bookingConfig.timeZone })}`,
      };
    });
    const workerRootCauses = new Map<string, number>();
    let workerLatestDetail = '';
    for (const row of workerRows.results ?? []) {
      const detail = String(row.detail_json ?? '');
      if (!workerLatestDetail) workerLatestDetail = detail;
      const cause = workerRootCause(detail);
      workerRootCauses.set(cause, (workerRootCauses.get(cause) ?? 0) + 1);
    }
    const recurringRootCause = [...workerRootCauses.entries()]
      .map(([cause, amount]) => `${amount} run(s): ${cause}`)
      .join(' ') || 'No failed recurring worker runs are recorded.';
    const workerFirst = (workerRows.results ?? []).at(-1)?.started_at ?? null;
    const workerLast = (workerRows.results ?? [])[0]?.started_at ?? null;
    const workerRecords = (workerRows.results ?? []).slice(0, 6).map((row) => ({
      label: `Run ${String(row.run_key ?? '')}`,
      detail: `${String(row.errors ?? 0)} error(s) · ${new Date(String(row.started_at)).toLocaleString('en-US', { timeZone: bookingConfig.timeZone })}`,
    }));

    const alerts: AlertRecord[] = [];
    const addAlert = (input: Omit<AlertRecord, 'status'>): void => {
      if (input.count <= 0) return;
      const state = alertStates.get(input.key);
      if (alertResolutionSuppresses(state, input.lastSeen)) return;
      const previousClosed = state?.status === 'resolved' || state?.status === 'dismissed';
      alerts.push({
        ...input,
        status: previousClosed ? 'new' : state?.status ?? 'new',
        ...(state?.acknowledged_at ? { acknowledgedAt: state.acknowledged_at } : {}),
        ...(state?.resolved_at ? { resolvedAt: state.resolved_at } : {}),
        ...(state?.resolution_note ? { resolutionNote: state.resolution_note } : {}),
        ...(state?.dismissed_at ? { dismissedAt: state.dismissed_at } : {}),
      });
    };

    const pendingFirst = stringOrNull((pendingRequestRows.results ?? []).at(-1)?.created_at);
    const pendingLast = stringOrNull((pendingRequestRows.results ?? [])[0]?.created_at);
    addAlert({
      key: 'requests.pending',
      kind: 'pending_requests',
      severity: 'medium',
      title: 'Pending reservation requests',
      message: `${requests} pending reservation request(s) need a decision.`,
      explanation:
        'These customers submitted a request but do not have a confirmed appointment. Some records may be internal tests or duplicates.',
      rootCause:
        'Requests remain pending until the owner reviews scope, availability, payment and any required documents. No customer email is sent by opening this view.',
      recommendation:
        'Review the filtered list, confirm eligible requests, decline or archive duplicates, and mark internal test requests as test data before archiving them.',
      count: requests,
      firstSeen: pendingFirst,
      lastSeen: pendingLast,
      view: 'calendar',
      filter: 'pending',
      records: (pendingRequestRows.results ?? []).slice(0, 8).map((row) => ({
        label: String(row.quote_reference ?? row.id ?? 'Request'),
        detail: `${[row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unlinked customer'} · ${new Date(String(row.start_at ?? row.created_at)).toLocaleString('en-US', { timeZone: bookingConfig.timeZone })}`,
        ...(row.id ? { id: String(row.id) } : {}),
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'documents.unsigned',
      kind: 'unsigned_agreements',
      severity: 'medium',
      title: 'Agreement packets awaiting signature',
      message: `${unsignedAgreements} agreement packet(s) are waiting for signature.`,
      explanation:
        'A signing link has been created but every required document is not signed yet. The request may be expired, partially signed, or waiting on the customer.',
      rootCause:
        'Signing links expire after seven days. A customer may also have stopped before completing every required signature.',
      recommendation:
        'Open Documents & Agreements, review the request and signer, and resend only when the owner authorizes customer contact.',
      count: unsignedAgreements,
      firstSeen: stringOrNull((unsignedRows.results ?? []).at(-1)?.created_at),
      lastSeen: stringOrNull((unsignedRows.results ?? [])[0]?.created_at),
      view: 'documents',
      records: (unsignedRows.results ?? []).slice(0, 8).map((row) => ({
        label: String(row.packet_name || row.bundle_code || 'Signing request'),
        detail: `${String(row.signer_email || 'No signer email')} · ${String(row.status)} · ${new Date(String(row.created_at)).toLocaleString('en-US', { timeZone: bookingConfig.timeZone })}`,
        ...(row.id ? { id: String(row.id) } : {}),
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'finance.outstanding_invoices',
      kind: 'outstanding_invoices',
      severity: 'medium',
      title: 'Outstanding invoice balances',
      message: `${outstandingInvoices} invoice(s) have an outstanding balance.`,
      explanation:
        'The invoice is open, partially paid or overdue. This is a financial follow-up item, not a payment processor failure.',
      rootCause:
        'The customer has not paid the full balance, or a partial payment is still outstanding.',
      recommendation:
        'Open Finance, review the invoice and payment history, and contact the customer only through an owner-approved action.',
      count: outstandingInvoices,
      firstSeen: stringOrNull((invoiceRows.results ?? []).at(-1)?.created_at),
      lastSeen: stringOrNull((invoiceRows.results ?? [])[0]?.created_at),
      view: 'finance',
      records: (invoiceRows.results ?? []).slice(0, 8).map((row) => ({
        label: String(row.number ?? row.id ?? 'Invoice'),
        detail: `Balance $${(Number(row.balance_cents ?? 0) / 100).toFixed(2)}${row.due_date ? ` · due ${String(row.due_date)}` : ''}`,
        ...(row.id ? { id: String(row.id) } : {}),
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'recurring.worker_failures',
      kind: 'recurring_worker',
      severity: 'high',
      title: 'Recurring worker failures',
      message: `${failedWorkerRuns} recurring worker run(s) failed.`,
      explanation:
        'These are daily recurring-plan synchronization runs. Some failures are historical; the plan and existing appointments are preserved.',
      rootCause: recurringRootCause || workerLatestDetail.slice(0, 400),
      recommendation:
        'Open Recurring Plans, review active plans and conflicts, retry safe syncs, and reauthorize Google Calendar if authentication failed. Historical runs remain inspectable.',
      count: failedWorkerRuns,
      firstSeen: stringOrNull(workerFirst),
      lastSeen: stringOrNull(workerLast),
      view: 'recurring',
      records: workerRecords,
      canRecheck: true,
    });
    addAlert({
      key: 'checkout.sessions',
      kind: 'checkout_failure',
      severity: 'medium',
      title: 'Checkout sessions needing review',
      message: `${failedCheckouts} failed checkout session(s); ${abandonedCheckouts} abandoned session(s) are informational.`,
      explanation:
        'Only failed sessions are treated as an operational alert. Abandoned checkouts are ordinary customer behavior and are not a production outage.',
      rootCause: checkoutRootCause,
      recommendation:
        'Open the filtered checkout list. Investigate failed setup/provider sessions; leave ordinary abandoned sessions as history. Never message customers automatically.',
      count: failedCheckouts,
      firstSeen: stringOrNull((checkoutRows.results ?? []).at(-1)?.created_at),
      lastSeen: stringOrNull((checkoutRows.results ?? [])[0]?.created_at),
      view: 'finance',
      filter: 'checkout',
      records: checkoutRecords,
      canRecheck: true,
    });
    addAlert({
      key: 'booking.commitments',
      kind: 'booking_recovery',
      severity: 'high',
      title: 'Booking commitments need reconciliation',
      message: `${failedCommitments} booking commitment(s) need reconciliation.`,
      explanation: 'A paid or confirmed booking commitment did not reach a clean final state.',
      rootCause: 'The commitment is failed, partially created, or has been pending for more than ten minutes.',
      recommendation: 'Open New Booking and reconcile the commitment before creating another appointment or charge.',
      count: failedCommitments,
      firstSeen: stringOrNull((failedCommitmentRows.results ?? []).at(-1)?.updated_at),
      lastSeen: stringOrNull((failedCommitmentRows.results ?? [])[0]?.updated_at),
      view: 'new-booking',
      records: (failedCommitmentRows.results ?? []).slice(0, 6).map((row) => ({
        label: String(row.id ?? 'Commitment'),
        detail: `${String(row.state ?? '')} · ${String(row.updated_at ?? '')}`,
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'finance.reconciliation',
      kind: 'financial_reconciliation',
      severity: 'high',
      title: 'Financial reconciliation issues',
      message: `${financialIssues} financial reconciliation issue(s) are open.`,
      explanation: 'A payment or ledger record does not reconcile with the expected financial state.',
      rootCause: 'The reconciliation issue was recorded for manual review.',
      recommendation: 'Open Finance and reconcile the payment before changing any financial record.',
      count: financialIssues,
      firstSeen: stringOrNull((reconciliationRows.results ?? []).at(-1)?.created_at),
      lastSeen: stringOrNull((reconciliationRows.results ?? [])[0]?.created_at),
      view: 'finance',
      records: (reconciliationRows.results ?? []).slice(0, 6).map((row) => ({
        label: String(row.issue_type ?? row.id ?? 'Issue'),
        detail: String(row.created_at ?? ''),
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'communications.booking',
      kind: 'booking_notification',
      severity: 'medium',
      title: 'Booking emails failed to send',
      message: `${failedNotifications} booking email(s) failed to send.`,
      explanation: 'The booking itself may be valid; only the email delivery failed.',
      rootCause: 'The email provider rejected or could not be reached. Provider acceptance is not inbox proof.',
      recommendation: 'Open Calendar & Requests, review the notification status, and retry only when owner-approved.',
      count: failedNotifications,
      firstSeen: null,
      lastSeen: null,
      view: 'calendar',
      records: [],
      canRecheck: true,
    });
    addAlert({
      key: 'payments.events',
      kind: 'payment_event',
      severity: 'high',
      title: 'Payment events failed or are incomplete',
      message: `${failedPaymentEvents} payment event(s) failed or are incomplete.`,
      explanation: 'A webhook or payment event did not finish processing.',
      rootCause: 'The event was recorded as failed or incomplete and must be reconciled against the provider.',
      recommendation: 'Open Finance and inspect the event before retrying or changing a booking.',
      count: failedPaymentEvents,
      firstSeen: stringOrNull((failedPaymentRows.results ?? []).at(-1)?.created_at),
      lastSeen: stringOrNull((failedPaymentRows.results ?? [])[0]?.created_at),
      view: 'finance',
      records: (failedPaymentRows.results ?? []).slice(0, 6).map((row) => ({
        label: String(row.quote_reference ?? row.id ?? 'Payment event'),
        detail: `${String(row.status ?? '')} · ${String(row.created_at ?? '')}`,
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'leads.delivery',
      kind: 'lead_delivery',
      severity: 'medium',
      title: 'Lead notifications failed delivery',
      message: `${failedLeads} lead notification(s) failed delivery.`,
      explanation: 'The inquiry was stored, but the owner notification did not reach the provider.',
      rootCause: 'The provider failed or the delivery configuration is incomplete.',
      recommendation: 'Open Leads & Inquiries, review the stored request, and retry delivery when appropriate.',
      count: failedLeads,
      firstSeen: stringOrNull((failedLeadRows.results ?? []).at(-1)?.created_at),
      lastSeen: stringOrNull((failedLeadRows.results ?? [])[0]?.created_at),
      view: 'leads',
      records: (failedLeadRows.results ?? []).slice(0, 6).map((row) => ({
        label: String(row.quote_reference ?? row.id ?? 'Lead'),
        detail: String(row.created_at ?? ''),
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'security.owner_mfa',
      kind: 'security_mfa',
      severity: 'high',
      title: 'Owner two-step verification is missing',
      message: 'An active owner account does not have two-step verification enabled.',
      explanation: 'The owner account can sign in without a second factor.',
      rootCause: 'MFA enrollment has not been completed for this active owner account.',
      recommendation: 'Open Settings & Audit and complete MFA enrollment for the owner account.',
      count: ownerMfaMissing,
      firstSeen: null,
      lastSeen: null,
      view: 'settings',
      records: [],
      canRecheck: true,
    });
    addAlert({
      key: 'staffing.pending',
      kind: 'staffing_pending',
      severity: 'high',
      title: 'Additional cleaners are required',
      message: `${staffingPending} confirmed job(s) still need an additional cleaner.`,
      explanation:
        'The customer selected a time that is operationally feasible with a larger crew. The appointment time and any payment are preserved, but the missing crew is not secured yet.',
      rootCause:
        'The quoted labor hours cannot be completed by the assigned crew inside the published operating window.',
      recommendation:
        'Open the Job File, assign an eligible additional cleaner, or contact the customer with a reschedule or refund option. The warning clears when staffing is resolved.',
      count: staffingPending,
      firstSeen: stringOrNull((staffingRows.results ?? [])[0]?.start_at),
      lastSeen: stringOrNull((staffingRows.results ?? []).at(-1)?.start_at),
      view: 'jobs',
      records: (staffingRows.results ?? []).slice(0, 8).map((row) => ({
        label: String(row.reference ?? row.id ?? 'Appointment'),
        detail: `${[row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer'} · ${new Date(String(row.start_at)).toLocaleString('en-US', { timeZone: bookingConfig.timeZone })} · crew ${String(row.crew_size ?? '?')} · ${String(row.staffing_reason ?? '')}`,
        ...(row.id ? { id: String(row.id) } : {}),
      })),
      canRecheck: true,
    });
    addAlert({
      key: 'jobs.unassigned',
      kind: 'unassigned_jobs',
      severity: 'medium',
      title: 'Upcoming jobs without an assigned cleaner',
      message: `${unassignedJobs} upcoming job(s) have no assigned cleaner.`,
      explanation: 'The appointment exists but no active team member is assigned.',
      rootCause: 'The job has not been assigned manually or by an authorized automatic dispatch run.',
      recommendation: 'Open Jobs & Team, review the unassigned queue, and assign an eligible cleaner.',
      count: unassignedJobs,
      firstSeen: null,
      lastSeen: null,
      view: 'jobs',
      records: [],
      canRecheck: true,
    });
    const alertHistory = [...alertStates.values()]
      .filter((state) => state.status === 'resolved' || state.status === 'dismissed')
      .map((state) => ({
        key: state.alert_key,
        status: state.status,
        resolvedAt: state.resolved_at,
        dismissedAt: state.dismissed_at,
        note: state.resolution_note,
        updatedAt: state.updated_at,
      }));

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
        failedWorkerRunsHistory,
        abandonedCheckouts,
        todayJobs,
        tomorrowJobs,
        unassignedJobs,
        staffingPending,
        unsignedAgreements,
        outstandingInvoices,
        failedCommunications,
        failedCheckouts,
        ownerMfaMissing,
      },
      alerts,
      alertHistory,
      today,
      recentLeads: recent.results ?? [],
    });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 500;
    const code = error instanceof AdminAuthError ? error.code : 'overview_failed';
    return json({ ok: false, error: code }, status);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'lead.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '').trim() as OperationalAlertAction;
    if (!['acknowledge', 'investigate', 'resolve', 'dismiss', 'reopen'].includes(action)) {
      return json({ ok: false, error: 'invalid_action' }, 400);
    }
    const state = await applyAlertAction(db, actor, {
      alertKey: String(body.alertKey ?? ''),
      action,
      note: String(body.note ?? ''),
      title: String(body.title ?? ''),
      kind: String(body.kind ?? ''),
    });
    return json({ ok: true, alert: state });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'alert_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
