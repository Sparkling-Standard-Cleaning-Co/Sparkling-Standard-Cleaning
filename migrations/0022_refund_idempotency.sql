-- Refund attempts are immutable evidence and must be safe to retry.
ALTER TABLE refunds ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_idempotency_key
  ON refunds(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
