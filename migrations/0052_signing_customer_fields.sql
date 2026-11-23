-- Customer-provided access and service instructions for the signed schedule.
-- Additive only. Approved agreement wording is unchanged.
PRAGMA foreign_keys = ON;

ALTER TABLE signing_requests ADD COLUMN customer_fields_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_signing_requests_customer_fields
  ON signing_requests(id) WHERE customer_fields_json <> '{}';
