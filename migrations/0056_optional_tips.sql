-- Optional customer gratuities on invoice payments and tip-only follow-ups.
-- Additive only. Existing payments/refunds are treated as service revenue.

ALTER TABLE payments ADD COLUMN service_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN tip_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN tip_refunded_cents INTEGER NOT NULL DEFAULT 0;
UPDATE payments SET service_cents = amount_cents WHERE service_cents = 0 AND amount_cents > 0;

ALTER TABLE refunds ADD COLUMN service_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refunds ADD COLUMN tip_cents INTEGER NOT NULL DEFAULT 0;
UPDATE refunds SET service_cents = amount_cents WHERE service_cents = 0 AND amount_cents > 0;

CREATE INDEX IF NOT EXISTS idx_payments_tips
  ON payments(tip_cents) WHERE tip_cents > 0;

CREATE TABLE IF NOT EXISTS tip_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  status TEXT NOT NULL DEFAULT 'unallocated'
    CHECK (status IN ('unallocated', 'allocated', 'paid', 'reversed')),
  allocation_rule TEXT NOT NULL DEFAULT 'equal',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tip_allocations_payment
  ON tip_allocations(payment_id, status);
CREATE INDEX IF NOT EXISTS idx_tip_allocations_invoice
  ON tip_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_tip_allocations_member
  ON tip_allocations(team_member_id, status);
