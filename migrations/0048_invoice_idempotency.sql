-- Additive invoice idempotency for booking-request invoice generation.
-- Existing invoices remain untouched; the partial unique index prevents a
-- second invoice from being created for the same booking request.

ALTER TABLE invoices ADD COLUMN booking_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_booking_request_unique
  ON invoices(booking_request_id)
  WHERE booking_request_id IS NOT NULL;