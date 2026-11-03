-- One authoritative successful-payment claim per booking request.
--
-- Stripe can settle two different Checkout Sessions for the same hold when an
-- older host session completes during a replacement attempt. The session
-- registry prevents creating two open sessions, but only the payment itself is
-- proof of money received. This table makes the first successful payment the
-- booking's primary payment and lets later settlements be recognized,
-- projected and flagged without ever being silently discarded.

CREATE TABLE IF NOT EXISTS booking_payment_claims (
  booking_request_id TEXT PRIMARY KEY REFERENCES booking_requests(id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_booking_payment_claims_session
  ON booking_payment_claims(stripe_session_id);
