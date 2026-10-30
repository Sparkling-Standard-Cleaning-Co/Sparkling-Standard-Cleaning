-- Signed agreements and customer payment authorizations. Text remains
-- owner-directed; no third-party signature service is required.
PRAGMA foreign_keys = ON;

ALTER TABLE agreements ADD COLUMN document_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agreements ADD COLUMN document_title TEXT NOT NULL DEFAULT '';
ALTER TABLE agreements ADD COLUMN service_code TEXT NOT NULL DEFAULT '';
ALTER TABLE agreements ADD COLUMN property_id TEXT REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE agreements ADD COLUMN signer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE agreements ADD COLUMN signer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE agreements ADD COLUMN signature_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agreements ADD COLUMN signed_content_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE agreements ADD COLUMN signed_ip_hash TEXT;
ALTER TABLE agreements ADD COLUMN signed_user_agent_hash TEXT;
ALTER TABLE agreements ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS payment_authorizations (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  service_code TEXT NOT NULL DEFAULT '',
  saved_payment_method_id TEXT REFERENCES saved_payment_methods(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  max_amount_cents INTEGER NOT NULL DEFAULT 0,
  charge_after_service INTEGER NOT NULL DEFAULT 1 CHECK (charge_after_service IN (0,1)),
  terms_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_signature' CHECK (status IN ('pending_signature','pending_card','active','used','revoked','expired')),
  signing_token_hash TEXT,
  token_expires_at TEXT,
  signed_at TEXT,
  used_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_authorizations_customer ON payment_authorizations(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_authorizations_token ON payment_authorizations(signing_token_hash);
CREATE INDEX IF NOT EXISTS idx_agreements_customer ON agreements(customer_id, created_at);
