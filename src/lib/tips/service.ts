import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit, type AdminActor } from '../admin/operations.ts';
import { suggestedTipCents, tipsConfig } from '../../config/tips.ts';

export interface InvoiceTipPayment {
  id: string;
  amount_cents: number;
  service_cents: number;
  tip_cents: number;
  status: string;
  received_at: string | null;
  stripe_payment_intent_id: string | null;
}

export interface InvoiceTipAllocation {
  id: string;
  payment_id: string;
  team_member_id: string | null;
  team_member_name: string;
  amount_cents: number;
  refunded_cents: number;
  status: string;
  created_at: string;
}

function now(): string {
  return new Date().toISOString();
}

function moneyText(value: unknown): string {
  return String(value ?? '');
}

export async function loadInvoiceTipView(
  db: D1Database,
  invoiceId: string,
): Promise<Record<string, unknown> | null> {
  const invoice = await db
    .prepare(
      `SELECT i.id, i.number, i.status, i.total_cents, i.amount_paid_cents, i.balance_cents,
              i.due_date, i.service_code, i.service_date, i.appointment_id, i.customer_id, i.branch_id,
              COALESCE(NULLIF(i.service_label, ''), s.name) AS service_name,
              c.first_name, c.last_name, c.company_name,
              a.status AS appointment_status,
              (SELECT COALESCE(SUM(p.tip_cents), 0) FROM payments p
                WHERE p.invoice_id = i.id AND p.status IN ('succeeded','partially_refunded','refunded')) AS tip_collected_cents,
              (SELECT COALESCE(SUM(r.tip_cents), 0) FROM refunds r
                JOIN payments p2 ON p2.id = r.payment_id
                WHERE p2.invoice_id = i.id AND r.status = 'succeeded') AS tip_refunded_cents
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN services s ON s.code = i.service_code
       LEFT JOIN appointments a ON a.id = i.appointment_id
       WHERE i.id = ? LIMIT 1`,
    )
    .bind(invoiceId)
    .first<Record<string, unknown>>();
  if (!invoice || String(invoice.status) === 'void') return null;
  const lines = await db
    .prepare(
      `SELECT description, quantity, total_cents, kind
       FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order`,
    )
    .bind(invoiceId)
    .all<Record<string, unknown>>();
  const balance = Math.max(0, Number(invoice.balance_cents) || 0);
  const customerName =
    [invoice.first_name, invoice.last_name].filter(Boolean).join(' ').trim() ||
    String(invoice.company_name ?? '');
  const tipOnly = balance <= 0;
  return {
    invoiceId,
    invoiceNumber: String(invoice.number ?? ''),
    serviceName: String(invoice.service_name ?? ''),
    serviceDate: invoice.service_date ?? null,
    serviceCode: invoice.service_code ?? null,
    status: String(invoice.status ?? ''),
    customerName,
    branchId: invoice.branch_id ?? null,
    appointmentStatus: invoice.appointment_status ?? null,
    serviceTotalCents: Math.max(0, Number(invoice.total_cents) || 0),
    serviceBalanceCents: balance,
    amountPaidCents: Math.max(0, Number(invoice.amount_paid_cents) || 0),
    dueDate: invoice.due_date ?? null,
    tipCollectedCents: Math.max(0, Number(invoice.tip_collected_cents) || 0),
    tipRefundedCents: Math.max(0, Number(invoice.tip_refunded_cents) || 0),
    tipOnly,
    lines: lines.results ?? [],
    suggestionsCents: suggestedTipCents(),
    minimumTipCents: tipsConfig.minimumCents,
    maximumTipCents: tipsConfig.maximumCents,
    defaultTipCents: tipsConfig.defaultCents,
  };
}

export async function listInvoiceTips(
  db: D1Database,
  invoiceId: string,
): Promise<{
  payments: InvoiceTipPayment[];
  allocations: InvoiceTipAllocation[];
  summary: {
    collectedCents: number;
    refundedCents: number;
    allocatedCents: number;
    unallocatedCents: number;
    paidOutCents: number;
  };
}> {
  const payments = await db
    .prepare(
      `SELECT id, amount_cents, COALESCE(service_cents, amount_cents) AS service_cents,
              COALESCE(tip_cents, 0) AS tip_cents, status, received_at, stripe_payment_intent_id
       FROM payments WHERE invoice_id = ? AND COALESCE(tip_cents, 0) > 0
       ORDER BY created_at DESC`,
    )
    .bind(invoiceId)
    .all<InvoiceTipPayment>();
  const allocations = await db
    .prepare(
      `SELECT ta.id, ta.payment_id, ta.team_member_id,
              COALESCE(tm.display_name, 'Unallocated') AS team_member_name,
              ta.amount_cents, ta.refunded_cents, ta.status, ta.created_at
       FROM tip_allocations ta
       LEFT JOIN team_members tm ON tm.id = ta.team_member_id
       WHERE ta.invoice_id = ?
       ORDER BY ta.created_at, ta.id`,
    )
    .bind(invoiceId)
    .all<InvoiceTipAllocation>();
  const rows = allocations.results ?? [];
  const summary = rows.reduce(
    (total, row) => {
      total.refundedCents += Number(row.refunded_cents) || 0;
      if (row.status === 'reversed') return total;
      const remaining = Math.max(0, Number(row.amount_cents) - Number(row.refunded_cents));
      if (row.team_member_id) {
        total.allocatedCents += remaining;
        if (row.status === 'paid') total.paidOutCents += remaining;
      } else {
        total.unallocatedCents += remaining;
      }
      return total;
    },
    { collectedCents: 0, refundedCents: 0, allocatedCents: 0, unallocatedCents: 0, paidOutCents: 0 },
  );
  summary.collectedCents = (payments.results ?? []).reduce(
    (total, payment) => total + Math.max(0, Number(payment.tip_cents) || 0),
    0,
  );
  return { payments: payments.results ?? [], allocations: rows, summary };
}

async function actualParticipants(db: D1Database, appointmentId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT ti.team_member_id
       FROM time_intervals ti
       WHERE ti.appointment_id = ?
         AND ti.team_member_id IS NOT NULL
         AND ti.kind = 'work'
         AND ti.status IN ('closed', 'corrected')
         AND ti.ended_at IS NOT NULL
       ORDER BY ti.team_member_id`,
    )
    .bind(appointmentId)
    .all<{ team_member_id: string }>();
  return [...new Set((rows.results ?? []).map((row) => row.team_member_id).filter(Boolean))].sort();
}

export function equalSplit(totalCents: number, memberIds: string[]): Array<{ teamMemberId: string; amountCents: number }> {
  const ids = [...new Set(memberIds.filter(Boolean))].sort();
  const total = Math.max(0, Math.round(totalCents));
  if (ids.length === 0 || total === 0) return [];
  const base = Math.floor(total / ids.length);
  const remainder = total - base * ids.length;
  return ids
    .map((teamMemberId, index) => ({
      teamMemberId,
      amountCents: base + (index < remainder ? 1 : 0),
    }))
    .filter((entry) => entry.amountCents > 0);
}

export async function allocateTipForPayment(
  db: D1Database,
  paymentId: string,
): Promise<{ status: 'none' | 'allocated' | 'unallocated'; tipCents: number; allocationCount: number }> {
  const payment = await db
    .prepare('SELECT * FROM payments WHERE id = ? LIMIT 1')
    .bind(paymentId)
    .first<Record<string, unknown>>();
  if (!payment) return { status: 'none', tipCents: 0, allocationCount: 0 };
  const tipCents = Math.max(0, Number(payment.tip_cents) || 0);
  if (tipCents === 0) return { status: 'none', tipCents: 0, allocationCount: 0 };
  const existing = await db
    .prepare("SELECT COUNT(*) AS n FROM tip_allocations WHERE payment_id = ? AND status <> 'reversed'")
    .bind(paymentId)
    .first<{ n: number }>();
  if (Number(existing?.n ?? 0) > 0) {
    return { status: 'allocated', tipCents, allocationCount: Number(existing?.n ?? 0) };
  }
  const invoice = payment.invoice_id
    ? await db
        .prepare('SELECT appointment_id FROM invoices WHERE id = ? LIMIT 1')
        .bind(String(payment.invoice_id))
        .first<{ appointment_id: string | null }>()
    : null;
  const appointmentId = String(invoice?.appointment_id ?? '') || null;
  const participants = appointmentId ? await actualParticipants(db, appointmentId) : [];
  const allocations = participants.length > 0
    ? equalSplit(tipCents, participants).map((entry) => ({
        teamMemberId: entry.teamMemberId,
        amountCents: entry.amountCents,
        status: 'allocated',
      }))
    : [{ teamMemberId: null, amountCents: tipCents, status: 'unallocated' }];
  for (const allocation of allocations) {
    await db
      .prepare(
        `INSERT INTO tip_allocations
         (id, payment_id, invoice_id, appointment_id, customer_id, team_member_id,
          amount_cents, status, allocation_rule, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `tip_${crypto.randomUUID()}`,
        paymentId,
        payment.invoice_id ?? null,
        appointmentId,
        payment.customer_id,
        allocation.teamMemberId,
        allocation.amountCents,
        allocation.status,
        tipsConfig.allocationRule,
        now(),
        now(),
      )
      .run();
  }
  const status = participants.length > 0 ? 'allocated' : 'unallocated';
  await db
    .prepare(
      `INSERT INTO admin_audit
       (id, actor_user_id, action, entity_type, entity_id, success, detail_json)
       VALUES (?, NULL, 'tips.allocated', 'payment', ?, 1, ?)`,
    )
    .bind(
      `audit_${crypto.randomUUID()}`,
      paymentId,
      JSON.stringify({ tipCents, participants: participants.length, status }),
    )
    .run();
  return { status, tipCents, allocationCount: allocations.length };
}

export async function assignTipParticipants(
  db: D1Database,
  actor: AdminActor,
  paymentId: string,
  teamMemberIds: string[],
): Promise<{ allocations: Array<{ teamMemberId: string; amountCents: number }> }> {
  if (!['owner', 'manager', 'finance'].includes(actor.role) && !actor.permissions.includes('finance.write')) {
    throw new AdminAuthError(403, 'forbidden');
  }
  const ids = [...new Set(teamMemberIds.filter(Boolean))];
  if (ids.length === 0) throw new AdminAuthError(400, 'tip_participants_required');
  const payment = await db
    .prepare('SELECT * FROM payments WHERE id = ? LIMIT 1')
    .bind(paymentId)
    .first<Record<string, unknown>>();
  if (!payment) throw new AdminAuthError(404, 'payment_not_found');
  const tipCents = Math.max(0, Number(payment.tip_cents) || 0);
  if (tipCents === 0) throw new AdminAuthError(409, 'payment_has_no_tip');
  const existing = await db
    .prepare("SELECT id, status FROM tip_allocations WHERE payment_id = ? AND status IN ('allocated','paid') LIMIT 1")
    .bind(paymentId)
    .first();
  if (existing) throw new AdminAuthError(409, 'tips_already_allocated');
  const members: Array<{ id: string }> = [];
  for (const memberId of ids) {
    const member = await db
      .prepare("SELECT id FROM team_members WHERE id = ? AND status = 'active' LIMIT 1")
      .bind(memberId)
      .first<{ id: string }>();
    if (!member) throw new AdminAuthError(400, 'team_member_invalid');
    members.push(member);
  }
  const splits = equalSplit(tipCents, members.map((member) => member.id));
  const statements = [
    db.prepare("UPDATE tip_allocations SET status = 'reversed', updated_at = ? WHERE payment_id = ? AND status = 'unallocated'").bind(now(), paymentId),
    ...splits.map((entry) =>
      db
        .prepare(
          `INSERT INTO tip_allocations
           (id, payment_id, invoice_id, appointment_id, customer_id, team_member_id,
            amount_cents, status, allocation_rule, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'allocated', ?, ?, ?)`,
        )
        .bind(
          `tip_${crypto.randomUUID()}`,
          paymentId,
          payment.invoice_id ?? null,
          payment.appointment_id ?? null,
          payment.customer_id,
          entry.teamMemberId,
          entry.amountCents,
          tipsConfig.allocationRule,
          now(),
          now(),
        ),
    ),
  ];
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'tips.participants_confirmed',
    entityType: 'payment',
    entityId: paymentId,
    detail: splits.map((entry) => `${entry.teamMemberId}:${entry.amountCents}`).join(','),
  });
  return { allocations: splits };
}

export async function syncTipRefundAllocations(
  db: D1Database,
  paymentId: string,
  totalTipRefundedCents: number,
): Promise<void> {
  const target = Math.max(0, Math.round(totalTipRefundedCents));
  const rows = await db
    .prepare(
      `SELECT id, amount_cents, status
       FROM tip_allocations WHERE payment_id = ? ORDER BY created_at, id`,
    )
    .bind(paymentId)
    .all<{ id: string; amount_cents: number; status: string }>();
  let remaining = target;
  for (const row of rows.results ?? []) {
    const amount = Math.max(0, Number(row.amount_cents) || 0);
    const refunded = Math.min(amount, remaining);
    remaining -= refunded;
    const baseStatus =
      row.status === 'unallocated' || row.status === 'paid' || row.status === 'allocated'
        ? row.status
        : 'allocated';
    const status = refunded >= amount && amount > 0 ? 'reversed' : baseStatus;
    await db
      .prepare('UPDATE tip_allocations SET refunded_cents = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(refunded, status, now(), row.id)
      .run();
  }
  await db
    .prepare('UPDATE payments SET tip_refunded_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(target - remaining, paymentId)
    .run()
    .catch(() => undefined);
}

export async function tipStatusSummary(
  db: D1Database,
  invoiceId: string,
): Promise<{ collectedCents: number; allocatedCents: number; unallocatedCents: number }> {
  const tips = await listInvoiceTips(db, invoiceId);
  return {
    collectedCents: tips.summary.collectedCents,
    allocatedCents: tips.summary.allocatedCents,
    unallocatedCents: tips.summary.unallocatedCents,
  };
}

export function tipMoney(value: unknown): string {
  return moneyText(value);
}
