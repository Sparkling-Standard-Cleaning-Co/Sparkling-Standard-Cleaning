-- Separate booking deadline from service-completion deadline. Additive only.
PRAGMA foreign_keys = ON;

ALTER TABLE promotions ADD COLUMN booking_deadline_at TEXT;
ALTER TABLE promotions ADD COLUMN service_deadline_at TEXT;

-- Owner-approved Thanksgiving terms. Status remains draft until activation.
UPDATE promotions
SET min_purchase_cents = 20000,
    max_discount_cents = 7500,
    max_redemptions = 20,
    per_customer_limit = 1,
    combinable = 0,
    booking_deadline_at = '2026-11-24T05:59:59Z',
    service_deadline_at = '2026-11-26T05:59:59Z',
    expires_at = '2026-11-26T05:59:59Z',
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'THANKS75';
