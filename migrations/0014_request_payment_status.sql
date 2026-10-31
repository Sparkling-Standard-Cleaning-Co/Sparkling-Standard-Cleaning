-- Authoritative payment summary for estimate booking requests.
ALTER TABLE booking_requests ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE booking_requests ADD COLUMN payment_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_requests ADD COLUMN payment_amount_cents INTEGER;
ALTER TABLE booking_requests ADD COLUMN paid_at TEXT;
CREATE INDEX IF NOT EXISTS idx_requests_payment ON booking_requests(payment_status, paid_at);
