import type { AdminActor } from './operations.ts';
import type { D1Database } from './d1.ts';

function scope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

export async function operationsReport(
  db: D1Database,
  actor: AdminActor,
): Promise<Record<string, unknown>> {
  const customerBranch = scope(actor, 'primary_branch_id');
  const leadBranch = scope(actor, 'branch_id');
  const appointmentBranch = scope(actor, 'branch_id');
  const invoiceBranch = scope(actor, 'branch_id');
  const paymentBranch = scope(actor, 'branch_id');
  const recurringBranch = scope(actor, 'branch_id');
  const giftBranch = scope(actor, 'branch_id');

  const [
    customers,
    leads,
    appointments,
    invoices,
    payments,
    recurring,
    gifts,
    monthly,
    branches,
    estimates,
    refunds,
    recurringPrices,
  ] = await Promise.all([
    db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
       FROM customers WHERE source <> 'financial_system' ${customerBranch.sql}`,
    ).bind(...customerBranch.bind).first<Record<string, number>>(),
    db.prepare(
      `SELECT status, COUNT(*) AS count FROM leads WHERE 1 = 1 ${leadBranch.sql} GROUP BY status`,
    ).bind(...leadBranch.bind).all(),
    db.prepare(
      `SELECT status, COUNT(*) AS count FROM appointments WHERE 1 = 1 ${appointmentBranch.sql} GROUP BY status`,
    ).bind(...appointmentBranch.bind).all(),
    db.prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_cents),0) AS total_cents
       FROM invoices WHERE 1 = 1 ${invoiceBranch.sql} GROUP BY status`,
    ).bind(...invoiceBranch.bind).all(),
    db.prepare(
      `SELECT provider, status, COUNT(*) AS count, COALESCE(SUM(amount_cents),0) AS total_cents
       FROM payments WHERE 1 = 1 ${paymentBranch.sql} GROUP BY provider, status`,
    ).bind(...paymentBranch.bind).all(),
    db.prepare(
      `SELECT status, COUNT(*) AS count FROM recurring_plans WHERE 1 = 1 ${recurringBranch.sql} GROUP BY status`,
    ).bind(...recurringBranch.bind).all(),
    db.prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(balance_cents),0) AS balance_cents
       FROM gift_certificates WHERE 1 = 1 ${giftBranch.sql} GROUP BY status`,
    ).bind(...giftBranch.bind).all(),
    db.prepare(
      `SELECT substr(COALESCE(received_at, created_at), 1, 7) AS month,
              COUNT(*) AS payment_count, COALESCE(SUM(amount_cents),0) AS payment_cents
       FROM payments WHERE status = 'succeeded' ${paymentBranch.sql}
       GROUP BY month ORDER BY month DESC LIMIT 12`,
    ).bind(...paymentBranch.bind).all(),
    db.prepare(
      `SELECT id, name, status, timezone, city, state FROM branches ORDER BY name`,
    ).all(),
    db.prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_cents),0) AS total_cents
       FROM estimates WHERE 1 = 1 ${scope(actor, 'branch_id').sql}
       GROUP BY status`,
    ).bind(...scope(actor, 'branch_id').bind).all(),
    db.prepare(
      `SELECT r.status, COUNT(*) AS count, COALESCE(SUM(r.amount_cents),0) AS total_cents
       FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE 1 = 1 ${scope(actor, 'p.branch_id').sql}
       GROUP BY r.status`,
    ).bind(...scope(actor, 'p.branch_id').bind).all(),
    db.prepare(
      `SELECT frequency, COALESCE(SUM(ongoing_price_cents),0) AS price_cents
       FROM recurring_plans WHERE status = 'active' ${recurringBranch.sql}
       GROUP BY frequency`,
    ).bind(...recurringBranch.bind).all(),
  ]);

  const invoiceRows = (invoices.results ?? []) as Array<Record<string, unknown>>;
  const paymentRows = (payments.results ?? []) as Array<Record<string, unknown>>;
  const estimateRows = (estimates.results ?? []) as Array<Record<string, unknown>>;
  const refundRows = (refunds.results ?? []) as Array<Record<string, unknown>>;
  const sum = (rows: Array<Record<string, unknown>>, key: string, filter?: (row: Record<string, unknown>) => boolean): number =>
    rows.reduce((total, row) => filter && !filter(row) ? total : total + Number(row[key] ?? 0), 0);
  const invoicedCents = sum(invoiceRows, 'total_cents', (row) => String(row.status) !== 'void');
  const collectedCents = sum(paymentRows, 'total_cents', (row) => String(row.status) === 'succeeded');
  const outstandingCents = invoiceRows
    .filter((row) => ['open', 'partially_paid', 'overdue'].includes(String(row.status)))
    .reduce((total, row) => total + Number(row.balance_cents ?? 0), 0);
  const discountCents = invoiceRows
    .filter((row) => String(row.status) !== 'void')
    .reduce((total, row) => total + Number(row.discount_cents ?? 0), 0);
  const refundedCents = sum(refundRows, 'total_cents', (row) => String(row.status) === 'succeeded');
  const quotedCents = sum(estimateRows, 'total_cents', (row) =>
    ['quoted', 'preliminary', 'accepted'].includes(String(row.status)),
  );
  const recurringMultiplier: Record<string, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 };
  const recurringMonthlyCents = Math.round(
    (recurringPrices.results ?? []).reduce(
      (total, row) =>
        total + Number(row.price_cents ?? 0) * (recurringMultiplier[String(row.frequency)] ?? 0),
      0,
    ),
  );

  return {
    financial: {
      quotedCents,
      invoicedCents,
      collectedCents,
      outstandingCents,
      discountCents,
      refundedCents,
      recurringMonthlyCents,
      netCollectedCents: Math.max(0, collectedCents - refundedCents),
    },
    estimates: estimateRows,
    refunds: refundRows,
    customers: customers ?? { active: 0, archived: 0 },
    leads: leads.results ?? [],
    appointments: appointments.results ?? [],
    invoices: invoices.results ?? [],
    payments: payments.results ?? [],
    recurring: recurring.results ?? [],
    gifts: gifts.results ?? [],
    monthly: monthly.results ?? [],
    branches: branches.results ?? [],
  };
}
