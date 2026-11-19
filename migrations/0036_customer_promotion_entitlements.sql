-- Persistent customer-level promotional benefits (owner directive 2026-11-19).
-- Existing one-time promotion codes and redemptions remain unchanged.
CREATE TABLE IF NOT EXISTS customer_promotion_entitlements (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  percent REAL NOT NULL CHECK (percent > 0 AND percent <= 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  removed_at TEXT,
  removed_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  removal_reason TEXT NOT NULL DEFAULT '',
  policy_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (customer_id, promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_entitlement_active
  ON customer_promotion_entitlements(customer_id, code, status);

CREATE TABLE IF NOT EXISTS customer_promotion_entitlement_events (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES customer_promotion_entitlements(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('assigned', 'reactivated', 'removed', 'applied')),
  actor_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_entitlement_events
  ON customer_promotion_entitlement_events(entitlement_id, created_at);

ALTER TABLE recurring_plans ADD COLUMN entitlement_id TEXT
  REFERENCES customer_promotion_entitlements(id) ON DELETE SET NULL;
ALTER TABLE recurring_plans ADD COLUMN base_ongoing_price_cents INTEGER;
UPDATE recurring_plans
  SET base_ongoing_price_cents = ongoing_price_cents
  WHERE base_ongoing_price_cents IS NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_entitlement ON recurring_plans(entitlement_id);

ALTER TABLE invoices ADD COLUMN entitlement_id TEXT
  REFERENCES customer_promotion_entitlements(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN entitlement_discount_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_invoices_entitlement ON invoices(entitlement_id);
