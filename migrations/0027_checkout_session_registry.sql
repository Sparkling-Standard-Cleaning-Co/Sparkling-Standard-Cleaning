-- One active payment session per booking hold.
--
-- A customer can reach checkout more than once while an earlier Stripe
-- Checkout Session is still open (for example after changing an email or a
-- gift code). The partial unique index makes a second active session
-- impossible; the new request must expire and supersede the old session first.
-- Historical rows are retained so payment reconciliation can still explain
-- every attempt.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id TEXT PRIMARY KEY,
  booking_hold_id TEXT NOT NULL,
  quote_reference TEXT NOT NULL,
  attempt TEXT NOT NULL,
  stripe_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating', 'open', 'completed', 'expired', 'superseded', 'failed')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_one_active_hold
  ON checkout_sessions(booking_hold_id) WHERE status IN ('creating', 'open');

CREATE INDEX IF NOT EXISTS idx_checkout_attempt
  ON checkout_sessions(attempt);

CREATE INDEX IF NOT EXISTS idx_checkout_status_updated
  ON checkout_sessions(status, updated_at);
