-- Customer portal identity, sessions, service requests and audit trail.
-- Additive only. No existing customer, booking, invoice or document row is
-- changed. Portal access is granted only after a verified single-use email
-- link; tokens and session cookies are stored only as hashes.

CREATE TABLE IF NOT EXISTS customer_portal_tokens (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'login'
    CHECK (purpose IN ('login')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_hash TEXT,
  user_agent_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer
  ON customer_portal_tokens(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_expiry
  ON customer_portal_tokens(expires_at);

CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  verified_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_hash TEXT,
  user_agent_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_customer
  ON customer_portal_sessions(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_sessions_expiry
  ON customer_portal_sessions(expires_at);

CREATE TABLE IF NOT EXISTS customer_portal_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'reschedule', 'billing', 'service', 'documents')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','reviewing','resolved','closed')),
  department TEXT NOT NULL DEFAULT 'customerService',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_requests_customer
  ON customer_portal_requests(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_portal_audit (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_audit_customer
  ON customer_portal_audit(customer_id, created_at DESC);
