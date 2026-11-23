-- Branch-specific Google Calendar configuration and compliant review requests.
--
-- Additive and non-destructive. Existing branches, customers, appointments and
-- invoices are preserved. Review automation is disabled by default for every
-- branch and remains owner-gated.
--
-- Calendar IDs are optional server-side overrides. The application also reads
-- GOOGLE_CALENDAR_ID_PENSACOLA and GOOGLE_CALENDAR_ID_TAMPA from the function
-- environment; a missing branch calendar never falls back to another branch.

PRAGMA foreign_keys = ON;

ALTER TABLE branches ADD COLUMN calendar_id TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN calendar_name TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN review_url TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN review_requests_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (review_requests_enabled IN (0,1));
ALTER TABLE branches ADD COLUMN review_request_delay_hours INTEGER NOT NULL DEFAULT 24
  CHECK (review_request_delay_hours BETWEEN 1 AND 720);
ALTER TABLE branches ADD COLUMN review_request_max_per_customer INTEGER NOT NULL DEFAULT 1
  CHECK (review_request_max_per_customer BETWEEN 1 AND 12);

UPDATE branches SET
  review_url = CASE
    WHEN id = 'branch_pensacola' THEN 'https://g.page/r/CXAcv1Pp7OI2ECE/review'
    ELSE ''
  END,
  review_requests_enabled = 0,
  review_request_delay_hours = 24,
  review_request_max_per_customer = 1
WHERE id IN ('branch_pensacola','branch_tampa');

CREATE TABLE IF NOT EXISTS review_requests (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  customer_id TEXT,
  appointment_id TEXT,
  invoice_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','suppressed','failed','cancelled')),
  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email','sms','manual')),
  recipient TEXT NOT NULL DEFAULT '',
  review_url TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  suppressed_reason TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_requests_branch_status
  ON review_requests(branch_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_review_requests_customer
  ON review_requests(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_appointment
  ON review_requests(appointment_id);
