-- Provider-originated refund and dispute records. Stripe remains authoritative;
-- these rows are the audited D1 projection and are safe to retry by provider id.
CREATE TABLE IF NOT EXISTS payment_disputes (
  id TEXT PRIMARY KEY,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_dispute_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('warning_needs_response','needs_response','under_review','won','lost','charge_refunded','closed','unknown')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL DEFAULT '',
  evidence_due_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_disputes_payment
  ON payment_disputes(payment_id, updated_at);

CREATE TABLE IF NOT EXISTS payment_reconciliation_issues (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_event_id, kind)
);
