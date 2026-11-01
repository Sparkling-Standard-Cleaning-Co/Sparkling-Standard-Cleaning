-- Durable coordination for the daily recurring replenishment Worker.
CREATE TABLE IF NOT EXISTS recurring_worker_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  plans_scanned INTEGER NOT NULL DEFAULT 0,
  plans_synced INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_recurring_worker_runs_status
  ON recurring_worker_runs(status, started_at);
