-- Booking request management: auditable customer notifications, decline reasons
-- and proposed reschedule times. Additive only; no existing row is modified.

CREATE TABLE IF NOT EXISTS booking_notifications (
  id TEXT PRIMARY KEY,
  booking_request_id TEXT REFERENCES booking_requests(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('confirmation', 'decline', 'proposal', 'reschedule', 'cancellation')),
  recipient_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_status INTEGER,
  error_detail TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_booking_notifications_request
  ON booking_notifications(booking_request_id, created_at);

ALTER TABLE booking_requests ADD COLUMN decline_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_requests ADD COLUMN proposed_start_at TEXT;
ALTER TABLE booking_requests ADD COLUMN proposed_end_at TEXT;
ALTER TABLE booking_requests ADD COLUMN proposal_sent_at TEXT;

ALTER TABLE appointments ADD COLUMN proposed_start_at TEXT;
ALTER TABLE appointments ADD COLUMN proposed_end_at TEXT;
