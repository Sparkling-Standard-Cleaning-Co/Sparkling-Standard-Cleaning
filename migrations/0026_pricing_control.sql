-- Owner-controlled pricing versions.
--
-- The source-controlled pricing configuration remains the safe default until
-- the owner publishes a version here. Every published version is an immutable
-- snapshot; rollback creates a new version from an older snapshot rather than
-- rewriting history. Only one row may be published at a time.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pricing_versions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  config_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  based_on_version INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_by_email TEXT,
  published_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_one_published
  ON pricing_versions(status) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_pricing_status_version
  ON pricing_versions(status, version DESC);
