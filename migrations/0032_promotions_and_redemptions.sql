-- Owner-managed promotions and auditable redemptions. Additive only.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
  value_cents INTEGER NOT NULL DEFAULT 0,
  percent INTEGER NOT NULL DEFAULT 0,
  services_json TEXT NOT NULL DEFAULT '[]',
  branches_json TEXT NOT NULL DEFAULT '[]',
  min_purchase_cents INTEGER NOT NULL DEFAULT 0,
  max_discount_cents INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  max_redemptions INTEGER NOT NULL DEFAULT 0,
  per_customer_limit INTEGER NOT NULL DEFAULT 1,
  new_customers_only INTEGER NOT NULL DEFAULT 0 CHECK (new_customers_only IN (0,1)),
  recurring_only INTEGER NOT NULL DEFAULT 0 CHECK (recurring_only IN (0,1)),
  first_visit_only INTEGER NOT NULL DEFAULT 1 CHECK (first_visit_only IN (0,1)),
  combinable INTEGER NOT NULL DEFAULT 0 CHECK (combinable IN (0,1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','disabled','expired')),
  terms_version TEXT NOT NULL DEFAULT '2026-11-10.promotions.v1',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status, starts_at, expires_at);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  checkout_attempt TEXT NOT NULL,
  quote_reference TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','redeemed','released','refunded')),
  reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT,
  released_at TEXT,
  stripe_session_id TEXT,
  UNIQUE (promotion_id, checkout_attempt)
);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_code ON promotion_redemptions(promotion_id, status, customer_id);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_attempt ON promotion_redemptions(checkout_attempt);

-- Thanksgiving draft for owner review. It is NOT active.
INSERT OR IGNORE INTO promotions
  (id, name, code, kind, value_cents, services_json, branches_json, starts_at, expires_at,
   max_redemptions, per_customer_limit, new_customers_only, recurring_only, first_visit_only,
   combinable, status, terms_version)
VALUES
  ('promo_thanks75_draft', 'Thanksgiving Deep Clean Special', 'THANKS75', 'fixed', 7500,
   '["deep"]', '["branch_pensacola"]', '2026-11-01T00:00:00Z', '2026-11-25T23:59:59Z',
   0, 1, 0, 0, 1, 0, 'draft', '2026-11-10.promotions.v1');
