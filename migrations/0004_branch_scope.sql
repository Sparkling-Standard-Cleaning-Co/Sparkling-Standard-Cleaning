-- Cleaning-only branch scope for operational read models.
PRAGMA foreign_keys = ON;
ALTER TABLE booking_requests ADD COLUMN branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE gift_certificates ADD COLUMN branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_branch ON booking_requests(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_gifts_branch ON gift_certificates(branch_id, status);
