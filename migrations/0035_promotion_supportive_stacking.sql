-- Explicit compatibility with the Community Support eligibility discount.
ALTER TABLE promotions ADD COLUMN supportive_stackable INTEGER NOT NULL DEFAULT 0
  CHECK (supportive_stackable IN (0,1));

-- Owner directive 2026-11-18: THANKS75 may coexist with Community Support.
UPDATE promotions SET supportive_stackable = 1 WHERE code = 'THANKS75';
-- FRIENDS15 must never stack with Community Support.
UPDATE promotions SET supportive_stackable = 0 WHERE code = 'FRIENDS15';
