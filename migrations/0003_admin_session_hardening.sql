-- Admin session revocation and MFA status for the cleaning-only admin.
PRAGMA foreign_keys = ON;
ALTER TABLE admin_sessions ADD COLUMN revoked_at TEXT;
ALTER TABLE admin_users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
