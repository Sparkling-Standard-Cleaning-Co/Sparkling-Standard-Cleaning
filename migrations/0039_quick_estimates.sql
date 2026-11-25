-- Owner-only Quick Estimate drafts for phone and walk-in inquiries.
-- Drafts never create a customer, booking, hold, invoice or payment.

CREATE TABLE IF NOT EXISTS quick_estimates (
  id TEXT PRIMARY KEY,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'saved', 'converted', 'discarded')),
  engine TEXT NOT NULL DEFAULT 'residential',
  service_code TEXT NOT NULL DEFAULT '',
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  quote_reference TEXT NOT NULL DEFAULT '',
  pricing_version TEXT NOT NULL DEFAULT '',
  promotion_code TEXT NOT NULL DEFAULT '',
  input_json TEXT NOT NULL DEFAULT '{}',
  quote_json TEXT NOT NULL DEFAULT '{}',
  total_cents INTEGER,
  ongoing_cents INTEGER,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  address_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  converted_request_id TEXT,
  converted_at TEXT,
  discarded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quick_estimates_scope
  ON quick_estimates(branch_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_quick_estimates_customer
  ON quick_estimates(customer_id, created_at DESC);
