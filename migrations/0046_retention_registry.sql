-- Record retention registry and legal holds.
-- This migration records approved retention intent only. It does not delete,
-- archive or anonymize any business record. Permanent deletion remains an
-- explicit owner-reviewed operation outside this registry.

CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  retention_months INTEGER NOT NULL CHECK (retention_months >= 0),
  automatic_cleanup INTEGER NOT NULL DEFAULT 0 CHECK (automatic_cleanup IN (0,1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  approved_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legal_holds (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  released_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_legal_holds_subject
  ON legal_holds(subject_type, subject_id, status);

CREATE INDEX IF NOT EXISTS idx_legal_holds_status
  ON legal_holds(status, created_at DESC);
