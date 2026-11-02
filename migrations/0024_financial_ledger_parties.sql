-- Additive financial projection. Existing payments and refunds are untouched.
-- Gift purchasers remain financial parties; one internal ledger account is used
-- only for a payment whose payer is not a cleaning-service customer.
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

INSERT OR IGNORE INTO customers
  (id, primary_branch_id, first_name, last_name, status, source, notes_summary, do_not_contact)
VALUES
  ('customer_financial_system', NULL, 'Financial', 'Ledger', 'archived', 'financial_system',
   'Internal ledger account for payers who are not cleaning-service customers. Never contact.', 1);

ALTER TABLE payments ADD COLUMN payer_party_id TEXT REFERENCES financial_parties(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN booking_request_id TEXT REFERENCES booking_requests(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN gift_certificate_id TEXT REFERENCES gift_certificates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(payer_party_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_gift ON payments(gift_certificate_id);

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
