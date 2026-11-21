-- Email-code MFA and pending authenticator invalidation.
-- Pending, unverified authenticator secrets are cleared so a secret exposed
-- during setup cannot be completed later.

ALTER TABLE admin_users ADD COLUMN mfa_method TEXT NOT NULL DEFAULT 'totp';

UPDATE admin_users
SET mfa_secret = NULL,
    mfa_enabled = 0,
    mfa_method = 'totp',
    updated_at = CURRENT_TIMESTAMP
WHERE mfa_enabled = 0;

CREATE TABLE IF NOT EXISTS admin_email_mfa_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_email_mfa_user
  ON admin_email_mfa_challenges(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_admin_email_mfa_expiry
  ON admin_email_mfa_challenges(expires_at);