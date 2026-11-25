-- Persistent server-authoritative pricing snapshot for a signing request.
-- Additive only. Previously executed agreements remain unchanged.
PRAGMA foreign_keys = ON;

ALTER TABLE signing_requests ADD COLUMN pricing_snapshot_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_signing_requests_pricing_snapshot
  ON signing_requests(id) WHERE pricing_snapshot_json <> '{}';
