-- Document signing reminders. Additive only. Reminders never cancel an
-- appointment or agreement; they only send the approved signing link.

CREATE TABLE IF NOT EXISTS document_signing_reminders (
  id TEXT PRIMARY KEY,
  signing_request_id TEXT NOT NULL REFERENCES signing_requests(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL CHECK (reminder_key IN ('24h','72h')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','skipped')),
  error_code TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (signing_request_id, reminder_key)
);

CREATE INDEX IF NOT EXISTS idx_document_reminders_status
  ON document_signing_reminders(status, created_at);
