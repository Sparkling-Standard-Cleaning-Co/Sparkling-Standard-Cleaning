-- Commercial accounts, custom proposals, agreements and contract billing.
-- Structured scope is stored as validated JSON so the owner can describe any
-- facility without being forced into the public estimator configuration.

CREATE TABLE IF NOT EXISTS property_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'facility'
    CHECK (role IN ('billing','facility','manager','authorized','other')),
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_property_contacts_property
  ON property_contacts(property_id, role);

CREATE TABLE IF NOT EXISTS commercial_walkthroughs (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  walked_at TEXT NOT NULL,
  attendees TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  scope_notes TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commercial_walkthroughs_property
  ON commercial_walkthroughs(property_id, walked_at DESC);

CREATE TABLE IF NOT EXISTS commercial_proposals (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  proposal_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','sent','accepted','declined','expired','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  billing_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_frequency IN ('monthly','quarterly','semiannual','annual','per_visit')),
  payment_terms TEXT NOT NULL DEFAULT 'Net 15',
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  recurring_total_cents INTEGER NOT NULL DEFAULT 0,
  one_time_total_cents INTEGER NOT NULL DEFAULT 0,
  first_invoice_total_cents INTEGER NOT NULL DEFAULT 0,
  expiration_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  exclusions TEXT NOT NULL DEFAULT '',
  scope_json TEXT NOT NULL DEFAULT '{}',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  content_sha256 TEXT NOT NULL DEFAULT '',
  signing_request_id TEXT,
  contract_id TEXT,
  accepted_at TEXT,
  accepted_by_name TEXT NOT NULL DEFAULT '',
  accepted_by_email TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commercial_proposals_customer
  ON commercial_proposals(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_proposals_branch
  ON commercial_proposals(branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS commercial_proposal_revisions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES commercial_proposals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (proposal_id, version)
);

CREATE TABLE IF NOT EXISTS commercial_contracts (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES commercial_proposals(id) ON DELETE RESTRICT,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','ended')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  billing_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_frequency IN ('monthly','quarterly','semiannual','annual','per_visit')),
  payment_terms TEXT NOT NULL DEFAULT 'Net 15',
  recurring_total_cents INTEGER NOT NULL DEFAULT 0,
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  next_invoice_date TEXT,
  last_invoice_at TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commercial_contracts_next_invoice
  ON commercial_contracts(status, next_invoice_date);

CREATE TABLE IF NOT EXISTS commercial_contract_invoices (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES commercial_contracts(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE invoices ADD COLUMN commercial_contract_id TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_commercial_contract
  ON invoices(commercial_contract_id, created_at DESC);
