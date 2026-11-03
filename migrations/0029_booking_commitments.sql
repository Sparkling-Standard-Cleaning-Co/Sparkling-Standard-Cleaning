-- Durable booking commitment records.
--
-- Every admin or customer confirmation writes one row BEFORE the external
-- calendar write so a partially completed commitment is never invisible. The
-- row records which side of the transaction succeeded and what compensation
-- was attempted. This is an additive table; no existing booking row changes.

CREATE TABLE IF NOT EXISTS booking_commitments (
  id TEXT PRIMARY KEY,
  booking_request_id TEXT REFERENCES booking_requests(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  reference TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','calendar_created','committed','confirmed','failed','compensated','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  calendar_event_id TEXT NOT NULL DEFAULT '',
  calendar_owned INTEGER NOT NULL DEFAULT 0 CHECK (calendar_owned IN (0,1)),
  last_error TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_commitments_state
  ON booking_commitments(state, updated_at);

CREATE INDEX IF NOT EXISTS idx_booking_commitments_reference
  ON booking_commitments(reference);
