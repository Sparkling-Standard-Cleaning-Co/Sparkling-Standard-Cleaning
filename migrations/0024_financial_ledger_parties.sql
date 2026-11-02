-- Canonical financial parties and a payment ledger that can represent a gift
-- purchaser without inventing a cleaning-service customer.
CREATE TABLE IF NOT EXISTS financial_parties (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('service_payer','gift_purchaser','gift_recipient')),
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  email_normalized TEXT NOT NULL DEFAULT '',
  stripe_customer_id TEXT,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_parties_email
  ON financial_parties(kind, email_normalized)
  WHERE email_normalized <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_parties_stripe
  ON financial_parties(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_parties_customer
  ON financial_parties(customer_id);

ALTER TABLE gift_certificates ADD COLUMN purchaser_party_id TEXT;
ALTER TABLE gift_certificates ADD COLUMN recipient_party_id TEXT;
ALTER TABLE gift_certificates ADD COLUMN redeeming_customer_id TEXT;
ALTER TABLE gift_certificates ADD COLUMN purchaser_name TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_certificates ADD COLUMN purchaser_email TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_certificates ADD COLUMN recipient_name TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_certificates ADD COLUMN recipient_email TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_certificates ADD COLUMN message TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_certificates ADD COLUMN delivery_method TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_certificates ADD COLUMN delivery_status TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_certificates ADD COLUMN delivered_at TEXT;

PRAGMA foreign_keys = OFF;
BEGIN;
CREATE TABLE payments_new (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT,
  payer_party_id TEXT REFERENCES financial_parties(id) ON DELETE SET NULL,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  booking_request_id TEXT REFERENCES booking_requests(id) ON DELETE SET NULL,
  gift_certificate_id TEXT REFERENCES gift_certificates(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','cash','check','external')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded','void')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_customer_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO payments_new
  (id, branch_id, customer_id, invoice_id, appointment_id, provider, status,
   amount_cents, currency, stripe_customer_id, stripe_payment_intent_id,
   stripe_charge_id, idempotency_key, received_at, created_by_admin_user_id,
   metadata_json, created_at)
SELECT
  id, branch_id, customer_id, invoice_id, appointment_id, provider, status,
  amount_cents, currency, stripe_customer_id, stripe_payment_intent_id,
  stripe_charge_id, idempotency_key, received_at, created_by_admin_user_id,
  metadata_json, created_at
FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(payer_party_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_gift ON payments(gift_certificate_id);
COMMIT;
PRAGMA foreign_keys = ON;
