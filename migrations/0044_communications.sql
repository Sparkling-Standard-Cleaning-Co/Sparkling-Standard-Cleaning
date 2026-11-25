-- Communications & Notifications control center.
-- Owner-controlled notification routing, templates and permitted overrides are
-- stored in admin_settings under `communications.config`. Every save also
-- creates an immutable version snapshot here. Delivery events are operational
-- evidence only; they never contain message bodies or customer data.

CREATE TABLE IF NOT EXISTS communication_settings_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  settings_json TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_communication_versions_created
  ON communication_settings_versions(created_at DESC);

CREATE TABLE IF NOT EXISTS notification_delivery_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  department TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','failed','suppressed')),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_id TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 1,
  related_type TEXT NOT NULL DEFAULT '',
  related_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_status
  ON notification_delivery_events(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_event
  ON notification_delivery_events(event_key, created_at DESC);

-- Backup run heartbeats and escalated operational incidents. A backup is not
-- "verified" because a run reported success; independent restore evidence is
-- still required. These records drive missing/failed-backup alerting.

CREATE TABLE IF NOT EXISTS backup_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('success','failure')),
  summary TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_status
  ON backup_runs(status, recorded_at DESC);

CREATE TABLE IF NOT EXISTS operations_incidents (
  id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'critical'
    CHECK (severity IN ('critical','warning','info')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','resolved')),
  summary TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  opened_at TEXT NOT NULL,
  last_notified_at TEXT,
  escalation_sent_at TEXT,
  resolved_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_operations_incidents_status
  ON operations_incidents(status, opened_at);

