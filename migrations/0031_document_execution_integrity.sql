-- Document execution integrity: branch ownership, a bound signer identity,
-- countersignature evidence and an immutable executed-copy digest.
-- Additive only; existing signing requests keep working with empty values.

PRAGMA foreign_keys = ON;

ALTER TABLE signing_requests ADD COLUMN branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE signing_requests ADD COLUMN signer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE signing_requests ADD COLUMN executed_copy_text TEXT NOT NULL DEFAULT '';
ALTER TABLE signing_requests ADD COLUMN executed_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE signing_requests ADD COLUMN executed_at TEXT;
ALTER TABLE signing_requests ADD COLUMN counter_signed_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE signing_requests ADD COLUMN counter_signed_at TEXT;
ALTER TABLE signing_requests ADD COLUMN counter_signature_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_signing_requests_branch
  ON signing_requests(branch_id, status);
