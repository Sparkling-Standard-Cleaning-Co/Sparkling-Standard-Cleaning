-- Admin operations corrections: human estimate numbers, test-request marking,
-- and durable operational alert lifecycle.
PRAGMA foreign_keys = ON;

ALTER TABLE quick_estimates ADD COLUMN estimate_number TEXT NOT NULL DEFAULT '';

UPDATE quick_estimates
SET estimate_number = 'EST-' || strftime('%Y', created_at) || '-' || printf('%04d',
  (SELECT COUNT(*) FROM quick_estimates q2
   WHERE strftime('%Y', q2.created_at) = strftime('%Y', quick_estimates.created_at)
     AND (q2.created_at < quick_estimates.created_at
          OR (q2.created_at = quick_estimates.created_at AND q2.rowid <= quick_estimates.rowid))))
WHERE estimate_number = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_estimates_number
  ON quick_estimates(estimate_number) WHERE estimate_number <> '';

ALTER TABLE booking_requests ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE booking_requests ADD COLUMN test_marked_at TEXT;
ALTER TABLE booking_requests ADD COLUMN test_marked_by_admin_user_id TEXT
  REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_test
  ON booking_requests(is_test, created_at DESC);

CREATE TABLE IF NOT EXISTS operational_alerts (
  id TEXT PRIMARY KEY,
  alert_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'investigating', 'acknowledged', 'resolved', 'dismissed')),
  title TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  root_cause TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolved_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  resolution_note TEXT NOT NULL DEFAULT '',
  dismissed_at TEXT,
  dismissed_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operational_alerts_status
  ON operational_alerts(status, updated_at DESC);
