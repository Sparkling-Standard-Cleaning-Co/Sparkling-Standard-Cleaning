-- Request lifecycle: close, duplicate, archive and reopen metadata.
ALTER TABLE booking_requests ADD COLUMN archived_at TEXT;
ALTER TABLE booking_requests ADD COLUMN closed_at TEXT;
ALTER TABLE booking_requests ADD COLUMN closed_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_requests ADD COLUMN duplicate_of_request_id TEXT REFERENCES booking_requests(id) ON DELETE SET NULL;
ALTER TABLE booking_requests ADD COLUMN previous_status TEXT;
ALTER TABLE booking_requests ADD COLUMN archived_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_lifecycle ON booking_requests(archived_at, closed_at, status);
