-- Centralized backup administration. GitHub Actions remains the execution
-- engine; the admin control plane records durable jobs and schedule intent.
-- A single active job is allowed; the partial unique index prevents duplicate
-- manual or scheduled starts even under concurrent requests.

CREATE TABLE IF NOT EXISTS backup_control_jobs (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK (operation IN ('backup','verify','restore_test')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','success','failure','cancelled')),
  source TEXT NOT NULL CHECK (source IN ('admin','schedule')),
  scope TEXT NOT NULL DEFAULT 'complete' CHECK (scope IN ('complete','database')),
  archive_key TEXT NOT NULL DEFAULT '',
  github_run_id TEXT NOT NULL DEFAULT '',
  github_run_url TEXT NOT NULL DEFAULT '',
  requested_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  summary TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backup_control_jobs_history
  ON backup_control_jobs(requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_control_one_active
  ON backup_control_jobs(status)
  WHERE status IN ('queued','running');

CREATE TABLE IF NOT EXISTS backup_schedule (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  cadence TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily','weekly','monthly')),
  utc_hour INTEGER NOT NULL DEFAULT 8 CHECK (utc_hour BETWEEN 0 AND 23),
  utc_minute INTEGER NOT NULL DEFAULT 30 CHECK (utc_minute BETWEEN 0 AND 59),
  day_of_week INTEGER NOT NULL DEFAULT 0 CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  scope TEXT NOT NULL DEFAULT 'complete' CHECK (scope IN ('complete','database')),
  retention_daily INTEGER NOT NULL DEFAULT 30 CHECK (retention_daily BETWEEN 1 AND 365),
  retention_weekly INTEGER NOT NULL DEFAULT 12 CHECK (retention_weekly BETWEEN 1 AND 104),
  retention_monthly INTEGER NOT NULL DEFAULT 12 CHECK (retention_monthly BETWEEN 1 AND 120),
  updated_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO backup_schedule
  (id, enabled, cadence, utc_hour, utc_minute, day_of_week, day_of_month, scope,
   retention_daily, retention_weekly, retention_monthly)
VALUES ('primary', 1, 'daily', 8, 30, 0, 1, 'complete', 30, 12, 12);
