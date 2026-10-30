-- Tamper-evident signed text and Stripe Setup Checkout references.
PRAGMA foreign_keys = ON;
ALTER TABLE agreements ADD COLUMN signed_content_text TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_authorizations ADD COLUMN stripe_setup_session_id TEXT;
ALTER TABLE payment_authorizations ADD COLUMN setup_url TEXT;
