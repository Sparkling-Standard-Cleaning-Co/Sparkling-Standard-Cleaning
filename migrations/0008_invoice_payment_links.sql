-- Invoice payment-link and saved-customer references. No live charging is
-- enabled by this migration; the server requires explicit environment gates.
PRAGMA foreign_keys = ON;
ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE invoices ADD COLUMN payment_url TEXT;
ALTER TABLE invoices ADD COLUMN stripe_checkout_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_stripe ON customers(stripe_customer_id);
