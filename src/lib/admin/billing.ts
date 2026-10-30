import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import type { D1Database } from './d1.ts';

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cents(value: unknown): number {
  return Math.max(0, Math.round(Number(value) * 100) || 0);
}

function scope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function invoiceNumber(): string {
  const date = new Date();
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `INV-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function listInvoices(
  db: D1Database,
  actor: AdminActor,
  input: { status?: string; q?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const status = text(input.status, 20);
  const q = text(input.q, 120);
  const branch = scope(actor, 'i.branch_id');
  const result = await db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, p.line1, p.city
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       LEFT JOIN properties p ON p.id = i.property_id
       WHERE (? = '' OR i.status = ?)
         AND (? = '' OR i.number LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)
         ${branch.sql}
       ORDER BY i.created_at DESC LIMIT 200`,
    )
    .bind(status, status, q, `%${q}%`, `%${q}%`, `%${q}%`, ...branch.bind)
    .all();
  return result.results ?? [];
}

export async function getInvoice(
  db: D1Database,
  actor: AdminActor,
  invoiceId: string,
): Promise<Record<string, unknown> | null> {
  const branch = scope(actor, 'i.branch_id');
  const invoice = await db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, p.line1, p.city, p.state, p.postal_code
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       LEFT JOIN properties p ON p.id = i.property_id
       WHERE i.id = ? ${branch.sql} LIMIT 1`,
    )
    .bind(invoiceId, ...branch.bind)
    .first();
  if (!invoice) return null;
  const [lines, payments, refunds, credits] = await Promise.all([
    db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order').bind(invoiceId).all(),
    db.prepare('SELECT id, provider, status, amount_cents, received_at, created_at FROM payments WHERE invoice_id = ? ORDER BY created_at DESC').bind(invoiceId).all(),
    db.prepare('SELECT r.* FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.invoice_id = ? ORDER BY r.created_at DESC').bind(invoiceId).all(),
    db.prepare('SELECT * FROM credits WHERE customer_id = ? ORDER BY created_at DESC').bind(invoice.customer_id).all(),
  ]);
  return { invoice, lines: lines.results ?? [], payments: payments.results ?? [], refunds: refunds.results ?? [], credits: credits.results ?? [] };
}

export async function createInvoice(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string; number: string; totalCents: number }> {
  const customerId = text(input.customerId, 100);
  if (!customerId) throw new AdminAuthError(400, 'customer_required');
  const customer = await db
    .prepare(`SELECT c.id, c.primary_branch_id FROM customers c WHERE c.id = ? ${scope(actor, 'c.primary_branch_id').sql} LIMIT 1`)
    .bind(customerId, ...scope(actor, 'c.primary_branch_id').bind)
    .first<{ id: string; primary_branch_id: string | null }>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  const propertyId = text(input.propertyId, 100) || null;
  const appointmentId = text(input.appointmentId, 100) || null;
  if (propertyId) {
    const property = await db.prepare('SELECT id FROM properties WHERE id = ? AND customer_id = ? LIMIT 1').bind(propertyId, customerId).first();
    if (!property) throw new AdminAuthError(400, 'invoice_property_invalid');
  }
  if (appointmentId) {
    const appointment = await db.prepare('SELECT id FROM appointments WHERE id = ? AND customer_id = ? LIMIT 1').bind(appointmentId, customerId).first();
    if (!appointment) throw new AdminAuthError(400, 'invoice_appointment_invalid');
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) throw new AdminAuthError(400, 'invoice_lines_required');
  const issueDate = text(input.issueDate, 10) || new Date().toISOString().slice(0, 10);
  const dueDate = text(input.dueDate, 10) || issueDate;
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  const normalized: Array<{ description: string; quantity: number; unit: number; total: number; kind: string }> = [];
  for (const line of lines.slice(0, 50)) {
    const record = line as Record<string, unknown>;
    const quantity = Math.max(0, Number(record.quantity) || 1);
    const unit = Math.round(Number(record.unitAmountCents) || 0);
    const total = Math.round(Number(record.totalCents) || quantity * unit);
    const kind = ['service', 'extra', 'discount', 'tax', 'credit', 'adjustment'].includes(String(record.kind))
      ? String(record.kind)
      : 'service';
    const description = text(record.description, 300);
    if (!description) throw new AdminAuthError(400, 'invoice_line_description_required');
    if (total < 0 || unit < 0) throw new AdminAuthError(400, 'invoice_amount_invalid');
    if (kind === 'discount') discount += total;
    else if (kind === 'tax') tax += total;
    else subtotal += total;
    normalized.push({ description, quantity, unit, total, kind });
  }
  const totalCents = Math.max(0, subtotal - discount + tax);
  const invoiceId = id('invoice');
  const number = invoiceNumber();
  await db
    .prepare(
      `INSERT INTO invoices
       (id, branch_id, customer_id, property_id, appointment_id, number, status, issue_date, due_date,
        subtotal_cents, discount_cents, tax_cents, total_cents, amount_paid_cents, balance_cents,
        created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      invoiceId,
      customer.primary_branch_id,
      customerId,
      propertyId,
      appointmentId,
      number,
      issueDate,
      dueDate,
      subtotal,
      discount,
      tax,
      totalCents,
      totalCents,
      actor.id,
    )
    .run();
  for (const [index, line] of normalized.entries()) {
    await db
      .prepare(
        `INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_amount_cents, total_cents, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id('line'), invoiceId, line.kind, line.description, line.quantity, line.unit, line.total, index)
      .run();
  }
  await audit(db, { actorUserId: actor.id, action: 'invoice.created', entityType: 'invoice', entityId: invoiceId });
  return { id: invoiceId, number, totalCents };
}

export async function updateInvoiceStatus(
  db: D1Database,
  actor: AdminActor,
  invoiceId: string,
  status: string,
): Promise<void> {
  if (!['draft', 'open', 'void', 'overdue'].includes(status)) throw new AdminAuthError(400, 'invoice_status_invalid');
  const invoice = await db
    .prepare(`SELECT * FROM invoices WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(invoiceId, ...scope(actor, 'branch_id').bind)
    .first<Record<string, unknown>>();
  if (!invoice) throw new AdminAuthError(404, 'invoice_not_found');
  if (Number(invoice.amount_paid_cents) > 0 && status === 'void') throw new AdminAuthError(409, 'invoice_has_payments');
  await db.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), invoiceId).run();
  await audit(db, { actorUserId: actor.id, action: 'invoice.status_updated', entityType: 'invoice', entityId: invoiceId, detail: status });
}

export async function recordPayment(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const invoiceId = text(input.invoiceId, 100);
  const provider = text(input.provider, 20);
  if (!['cash', 'check', 'external'].includes(provider)) throw new AdminAuthError(400, 'payment_provider_invalid');
  const amount = cents(input.amount);
  if (amount <= 0) throw new AdminAuthError(400, 'payment_amount_invalid');
  const invoice = await db
    .prepare(`SELECT * FROM invoices WHERE id = ? ${scope(actor, 'branch_id').sql} LIMIT 1`)
    .bind(invoiceId, ...scope(actor, 'branch_id').bind)
    .first<Record<string, unknown>>();
  if (!invoice) throw new AdminAuthError(404, 'invoice_not_found');
  const paymentId = id('payment');
  const idempotency = text(input.idempotencyKey, 200) || id('idem');
  const previous = await db
    .prepare('SELECT id, invoice_id, amount_cents FROM payments WHERE idempotency_key = ? LIMIT 1')
    .bind(idempotency)
    .first<{ id: string; invoice_id: string | null; amount_cents: number }>();
  if (previous) {
    if (previous.invoice_id !== invoiceId || Number(previous.amount_cents) !== amount) {
      throw new AdminAuthError(409, 'payment_idempotency_conflict');
    }
    return { id: previous.id };
  }
  const balance = Number(invoice.balance_cents) || 0;
  if (amount > balance) throw new AdminAuthError(400, 'payment_exceeds_balance');
  await db
    .prepare(
      `INSERT INTO payments
       (id, branch_id, customer_id, invoice_id, provider, status, amount_cents, idempotency_key,
        received_at, created_by_admin_user_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?)`,
    )
    .bind(paymentId, invoice.branch_id, invoice.customer_id, invoiceId, provider, amount, idempotency, now(), actor.id, JSON.stringify({ note: text(input.note, 500), reference: text(input.reference, 120) }))
    .run();
  const paid = Number(invoice.amount_paid_cents) + amount;
  const nextBalance = Math.max(0, balance - amount);
  await db
    .prepare('UPDATE invoices SET amount_paid_cents = ?, balance_cents = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(paid, nextBalance, nextBalance === 0 ? 'paid' : 'partially_paid', now(), invoiceId)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'payment.recorded', entityType: 'payment', entityId: paymentId, detail: `${provider}:${amount}` });
  return { id: paymentId };
}

export async function recordRefund(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const paymentId = text(input.paymentId, 100);
  const payment = await db
    .prepare(`SELECT p.* FROM payments p WHERE p.id = ? AND p.provider <> 'stripe' ${scope(actor, 'p.branch_id').sql} LIMIT 1`)
    .bind(paymentId, ...scope(actor, 'p.branch_id').bind)
    .first<Record<string, unknown>>();
  if (!payment) throw new AdminAuthError(404, 'manual_payment_not_found');
  const amount = cents(input.amount);
  if (amount <= 0 || amount > Number(payment.amount_cents)) throw new AdminAuthError(400, 'refund_amount_invalid');
  const refundId = id('refund');
  await db
    .prepare(
      `INSERT INTO refunds (id, payment_id, amount_cents, reason, status, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, 'succeeded', ?)`,
    )
    .bind(refundId, paymentId, amount, text(input.reason, 500), actor.id)
    .run();
  await db.prepare("UPDATE payments SET status = 'partially_refunded' WHERE id = ?").bind(paymentId).run();
  const invoiceId = payment.invoice_id as string | null;
  if (invoiceId) {
    const invoice = await db.prepare('SELECT amount_paid_cents, total_cents FROM invoices WHERE id = ?').bind(invoiceId).first<{ amount_paid_cents: number; total_cents: number }>();
    if (invoice) {
      const paid = Math.max(0, Number(invoice.amount_paid_cents) - amount);
      const balance = Math.max(0, Number(invoice.total_cents) - paid);
      await db.prepare('UPDATE invoices SET amount_paid_cents = ?, balance_cents = ?, status = ?, updated_at = ? WHERE id = ?')
        .bind(paid, balance, balance === 0 ? 'paid' : 'partially_paid', now(), invoiceId)
        .run();
    }
  }
  await audit(db, { actorUserId: actor.id, action: 'refund.recorded', entityType: 'refund', entityId: refundId, detail: String(amount) });
  return { id: refundId };
}

export async function createCredit(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const customerId = text(input.customerId, 100);
  const amount = cents(input.amount);
  if (!customerId || amount <= 0) throw new AdminAuthError(400, 'credit_fields_required');
  const customer = await db
    .prepare(`SELECT id FROM customers WHERE id = ? ${scope(actor, 'primary_branch_id').sql} LIMIT 1`)
    .bind(customerId, ...scope(actor, 'primary_branch_id').bind)
    .first();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  const creditId = id('credit');
  await db
    .prepare(
      `INSERT INTO credits (id, customer_id, source, original_amount_cents, remaining_cents, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    )
    .bind(creditId, customerId, text(input.source, 80) || 'manual', amount, amount, text(input.expiresAt, 30) || null)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'credit.created', entityType: 'credit', entityId: creditId });
  return { id: creditId };
}

export async function financeSummary(
  db: D1Database,
  actor: AdminActor,
): Promise<Record<string, unknown>> {
  const branch = scope(actor, 'branch_id');
  const [invoices, payments, outstanding, gifts] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_cents),0) AS total FROM invoices WHERE 1=1 ${branch.sql}`).bind(...branch.bind).first<Record<string, number>>(),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status = 'succeeded' ${branch.sql}`).bind(...branch.bind).first<Record<string, number>>(),
    db.prepare(`SELECT COALESCE(SUM(balance_cents),0) AS total FROM invoices WHERE status IN ('open','partially_paid','overdue') ${branch.sql}`).bind(...branch.bind).first<Record<string, number>>(),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(balance_cents),0) AS balance FROM gift_certificates WHERE status = 'active' ${branch.sql}`).bind(...branch.bind).first<Record<string, number>>(),
  ]);
  return { invoices, payments, outstanding, gifts };
}
