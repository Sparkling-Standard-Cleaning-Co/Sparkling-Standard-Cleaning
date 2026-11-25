-- Signed service change orders / agreement amendments.
--
-- The original executed agreement and primary invoice remain immutable. A
-- change order records the proposed scope and price change, uses the existing
-- approved Additional Service and Add-On Authorization template through the
-- signing engine, and links any supplemental invoice afterward.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_change_orders (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  original_signing_request_id TEXT REFERENCES signing_requests(id) ON DELETE SET NULL,
  primary_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  supplemental_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  signing_request_id TEXT REFERENCES signing_requests(id) ON DELETE SET NULL,
  bundle_id TEXT REFERENCES document_bundles(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES document_templates(id) ON DELETE SET NULL,
  original_scope TEXT NOT NULL DEFAULT '',
  revised_scope TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  original_price_cents INTEGER NOT NULL DEFAULT 0,
  revised_price_cents INTEGER NOT NULL DEFAULT 0,
  adjustment_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','sent','signed','billed','declined','cancelled')),
  requested_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TEXT,
  effective_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_orders_appointment
  ON service_change_orders(appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_orders_customer
  ON service_change_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_orders_status
  ON service_change_orders(status, created_at DESC);
