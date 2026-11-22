-- Development-only collections and judgment tracking foundation.
-- No fee, interest, lien or enforcement action is activated by this schema.

CREATE TABLE IF NOT EXISTS collection_cases (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'disputed', 'final_demand', 'collections_review', 'judgment', 'resolved', 'closed')),
  stage TEXT NOT NULL DEFAULT 'current',
  principal_cents INTEGER NOT NULL DEFAULT 0,
  assessed_fee_cents INTEGER NOT NULL DEFAULT 0,
  interest_cents INTEGER NOT NULL DEFAULT 0,
  payments_cents INTEGER NOT NULL DEFAULT 0,
  credits_cents INTEGER NOT NULL DEFAULT 0,
  disputed_at TEXT,
  final_demand_at TEXT,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_cases_invoice
  ON collection_cases(invoice_id);

CREATE TABLE IF NOT EXISTS collection_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  body TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collection_events_case
  ON collection_events(case_id, created_at);

CREATE TABLE IF NOT EXISTS judgment_records (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  court_name TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL DEFAULT '',
  judgment_date TEXT NOT NULL,
  judgment_cents INTEGER NOT NULL DEFAULT 0,
  annual_rate_bps INTEGER NOT NULL DEFAULT 0,
  recording_county TEXT NOT NULL DEFAULT '',
  recording_date TEXT,
  initial_lien_expires_on TEXT,
  outer_limit_on TEXT,
  satisfied_at TEXT,
  satisfaction_recorded_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_judgment_records_case
  ON judgment_records(case_id);
