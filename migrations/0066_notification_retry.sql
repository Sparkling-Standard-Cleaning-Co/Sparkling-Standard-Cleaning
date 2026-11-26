-- Operator retry queue for operational email that the provider rejected.
-- Rendered notice content is stored so an authorized administrator can retry
-- the exact message. It is never exposed publicly and is purged with the
-- communications retention rules.

CREATE TABLE IF NOT EXISTS notification_retry_queue (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  department TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text_body TEXT NOT NULL,
  reply_to TEXT NOT NULL DEFAULT '',
  related_type TEXT NOT NULL DEFAULT '',
  related_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','discarded')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notification_retry_queue_status
  ON notification_retry_queue(status, created_at);
