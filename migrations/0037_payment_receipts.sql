-- Invoice payment receipt delivery audit and idempotency.
CREATE TABLE IF NOT EXISTS payment_receipts (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  provider TEXT NOT NULL DEFAULT 'resend',
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (invoice_id, payment_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_invoice ON payment_receipts(invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_status ON payment_receipts(status, created_at);
