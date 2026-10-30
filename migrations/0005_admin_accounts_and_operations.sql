-- Sparkling Standard cleaning-only administration: account lifecycle,
-- MFA challenges, settings and durable notification recovery metadata.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_mfa_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_mfa_user ON admin_mfa_challenges(user_id, expires_at);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_user ON admin_recovery_codes(user_id, used_at);

CREATE TABLE IF NOT EXISTS admin_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES admin_roles(id) ON DELETE RESTRICT,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_invitations_email ON admin_invitations(email, accepted_at);

CREATE TABLE IF NOT EXISTS admin_password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_resets_user ON admin_password_resets(user_id, used_at);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE leads ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN last_delivery_error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_leads_delivery ON leads(delivery_status, delivery_attempts);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON appointments(status, start_at);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, due_date);
