import type { D1Database } from '../admin/d1.ts';
import { audit } from '../admin/operations.ts';
import { sendCustomerReceipt, type ReceiptEmailEnv } from '../forms/customer-receipt.ts';
import type { ReceiptData, ReceiptLine } from '../payments/receipt.ts';

export interface InvoiceReceiptEnv extends ReceiptEmailEnv {}

export interface InvoiceReceiptResult {
  status: 'sent' | 'failed' | 'skipped' | 'not_found';
  receiptId?: string;
  providerMessageId?: string;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function moneyLineKind(kind: string): ReceiptLine['kind'] {
  if (kind === 'discount') return 'discount';
  if (kind === 'tax') return 'tax';
  return 'charge';
}

export async function loadInvoiceReceiptData(
  db: D1Database,
  invoiceId: string,
  paymentId = '',
): Promise<{ data: ReceiptData; paymentId: string } | null> {
  const invoice = await db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, c.company_name,
              (SELECT value FROM customer_contacts cc
               WHERE cc.customer_id = c.id AND cc.kind = 'email'
               ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1) AS customer_email,
              p.line1, p.line2, p.city, p.state, p.postal_code
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN properties p ON p.id = i.property_id
       WHERE i.id = ? LIMIT 1`,
    )
    .bind(invoiceId)
    .first<Record<string, unknown>>();
  if (!invoice) return null;
  const payment = paymentId
    ? await db
        .prepare("SELECT * FROM payments WHERE id = ? AND invoice_id = ? AND status = 'succeeded' LIMIT 1")
        .bind(paymentId, invoiceId)
        .first<Record<string, unknown>>()
    : await db
        .prepare("SELECT * FROM payments WHERE invoice_id = ? AND status = 'succeeded' ORDER BY received_at DESC LIMIT 1")
        .bind(invoiceId)
        .first<Record<string, unknown>>();
  if (!payment) return null;
  const lines = await db
    .prepare('SELECT kind, description, quantity, total_cents FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order')
    .bind(invoiceId)
    .all<Record<string, unknown>>();
  const customerName = [invoice.first_name, invoice.last_name].filter(Boolean).join(' ').trim() ||
    text(invoice.company_name, 200);
  const addressLines = [invoice.line1, invoice.line2, [invoice.city, invoice.state, invoice.postal_code].filter(Boolean).join(' ')]
    .map((line) => text(line, 200))
    .filter(Boolean);
  const receiptLines: ReceiptLine[] = (lines.results ?? [])
    .filter((line) => String(line.kind) !== 'tax')
    .map((line) => ({
      label: text(line.description, 300) || 'Cleaning service',
      amountCents: Math.round(Number(line.total_cents) || 0),
      kind: moneyLineKind(String(line.kind)),
    }));
  const balanceCents = Math.max(0, Number(invoice.balance_cents) || 0);
  const totalCents = Math.max(0, Number(invoice.total_cents) || 0);
  const data: ReceiptData = {
    receiptNumber: `${text(invoice.number, 80)}-R1`,
    reference: text(invoice.number, 80),
    paidAt: text(payment.received_at, 60) || new Date().toISOString(),
    service: `Cleaning service — ${text(invoice.number, 80)}`,
    ...(addressLines.length > 0 ? { serviceLocation: addressLines.join(', ') } : {}),
    ...(customerName ? { customerName } : {}),
    ...(text(invoice.customer_email, 200) ? { customerEmail: text(invoice.customer_email, 200) } : {}),
    lines: receiptLines,
    subtotalCents: Math.max(0, Number(invoice.subtotal_cents) || 0),
    taxCents: Math.max(0, Number(invoice.tax_cents) || 0),
    taxRatePercent: null,
    taxJurisdiction: null,
    totalCents,
    paidCents: Math.max(0, Number(payment.amount_cents) || 0),
    balanceCents,
    paymentStatus: balanceCents === 0 ? 'paid' : 'partially_paid',
    notes:
      'Thank you for choosing Sparkling Standard Cleaning Co.! We appreciate the opportunity to care for your home and look forward to delivering Standards That Sparkle.',
  };
  return { data, paymentId: String(payment.id) };
}

export async function deliverInvoiceReceipt(
  db: D1Database,
  env: InvoiceReceiptEnv,
  input: { invoiceId: string; paymentId?: string; actorUserId?: string | null; force?: boolean },
): Promise<InvoiceReceiptResult> {
  const loaded = await loadInvoiceReceiptData(db, input.invoiceId, input.paymentId ?? '');
  if (!loaded) return { status: 'not_found' };
  const existing = await db
    .prepare(
      `SELECT * FROM payment_receipts
       WHERE invoice_id = ? AND payment_id = ? AND channel = 'email' LIMIT 1`,
    )
    .bind(input.invoiceId, loaded.paymentId)
    .first<Record<string, unknown>>();
  if (existing?.status === 'sent' && input.force !== true) {
    return {
      status: 'sent',
      receiptId: String(existing.id),
      ...(existing.provider_message_id ? { providerMessageId: String(existing.provider_message_id) } : {}),
    };
  }
  const receiptId = existing?.id ? String(existing.id) : `receipt_${crypto.randomUUID()}`;
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO payment_receipts
         (id, invoice_id, payment_id, channel, provider, status)
         VALUES (?, ?, ?, 'email', 'resend', 'pending')`,
      )
      .bind(receiptId, input.invoiceId, loaded.paymentId)
      .run();
  }
  const outcome = await sendCustomerReceipt(
    loaded.data,
    env,
    input.force === true
      ? `invoice-receipt-resend-${loaded.paymentId}-${Date.now()}`
      : `invoice-receipt-${loaded.paymentId}`,
  );
  const status = outcome.status === 'sent' ? 'sent' : outcome.status.startsWith('skipped') ? 'skipped' : 'failed';
  await db
    .prepare(
      `UPDATE payment_receipts
       SET status = ?, provider_message_id = ?, error_code = ?, sent_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      status,
      outcome.providerMessageId ?? null,
      outcome.status === 'failed' ? `provider_${outcome.providerStatus ?? 'unknown'}` : outcome.status,
      status === 'sent' ? new Date().toISOString() : null,
      receiptId,
    )
    .run();
  await audit(db, {
    actorUserId: input.actorUserId ?? null,
    action: status === 'sent' ? 'invoice.receipt_sent' : 'invoice.receipt_failed',
    entityType: 'invoice',
    entityId: input.invoiceId,
    detail: `${loaded.paymentId}:${status}`,
  }).catch(() => undefined);
  return {
    status,
    receiptId,
    ...(outcome.providerMessageId ? { providerMessageId: outcome.providerMessageId } : {}),
  };
}
