import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import type { D1Database } from './d1.ts';

export interface GiftInvoiceInput {
  invoiceId: string;
  amountCents: number;
  giftCode: string;
  reference: string;
}

export interface GiftInvoiceResult {
  paymentId: string;
  duplicate: boolean;
  balanceCents: number;
  amountPaidCents: number;
}

/**
 * Records the invoice side of a gift-certificate redemption.
 *
 * The private gift ledger remains the authoritative balance. This writes the
 * matching invoice payment exactly once per redemption reference so a retry
 * cannot credit the same gift value twice. The schema's payment providers do
 * not include a gift type; 'external' with explicit gift metadata is used
 * rather than rebuilding the payments table.
 */
export async function applyGiftPaymentToInvoice(
  db: D1Database,
  actor: AdminActor,
  input: GiftInvoiceInput,
): Promise<GiftInvoiceResult> {
  const invoice = await db
    .prepare('SELECT * FROM invoices WHERE id = ? LIMIT 1')
    .bind(input.invoiceId)
    .first<Record<string, unknown>>();
  if (!invoice) throw new AdminAuthError(404, 'invoice_not_found');
  if (actor.role !== 'owner' && actor.branchId && invoice.branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'forbidden');
  }
  if (!['open', 'partially_paid', 'overdue'].includes(String(invoice.status))) {
    throw new AdminAuthError(409, 'invoice_not_payable');
  }
  const balance = Number(invoice.balance_cents) || 0;
  const amount = Math.round(input.amountCents);
  if (amount <= 0) throw new AdminAuthError(400, 'amount_invalid');
  if (amount > balance) throw new AdminAuthError(400, 'payment_exceeds_balance');

  const idempotencyKey = `gift-redemption:${input.reference}`;
  const existing = await db
    .prepare('SELECT id FROM payments WHERE idempotency_key = ? LIMIT 1')
    .bind(idempotencyKey)
    .first<{ id: string }>();
  if (existing) {
    return {
      paymentId: existing.id,
      duplicate: true,
      balanceCents: balance,
      amountPaidCents: Number(invoice.amount_paid_cents) || 0,
    };
  }

  const paymentId = `payment_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO payments
       (id, branch_id, customer_id, invoice_id, provider, status, amount_cents, currency,
        idempotency_key, received_at, created_by_admin_user_id, metadata_json)
       VALUES (?, ?, ?, ?, 'external', 'succeeded', ?, 'USD', ?, ?, ?, ?)`,
    )
    .bind(
      paymentId,
      invoice.branch_id ?? null,
      invoice.customer_id,
      input.invoiceId,
      amount,
      idempotencyKey,
      new Date().toISOString(),
      actor.id,
      JSON.stringify({ kind: 'gift_certificate', gift_code: input.giftCode, source: 'admin_gift_redemption' }),
    )
    .run();
  const paid = (Number(invoice.amount_paid_cents) || 0) + amount;
  const nextBalance = Math.max(0, (Number(invoice.total_cents) || 0) - paid);
  await db
    .prepare(
      `UPDATE invoices SET amount_paid_cents = ?, balance_cents = ?, status = ?,
         payment_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(paid, nextBalance, nextBalance === 0 ? 'paid' : 'partially_paid', input.invoiceId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'invoice.gift_applied',
    entityType: 'invoice',
    entityId: input.invoiceId,
    detail: `${input.giftCode}:${amount}`,
  });
  return { paymentId, duplicate: false, balanceCents: nextBalance, amountPaidCents: paid };
}
