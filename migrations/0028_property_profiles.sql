-- Complete customer property profiles.
--
-- Existing address, access and parking fields remain authoritative. The new
-- columns are additive and nullable/defaulted so every existing property row
-- continues to load without coercion or data loss.

PRAGMA foreign_keys = ON;

ALTER TABLE properties ADD COLUMN property_type TEXT NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN square_feet INTEGER;
ALTER TABLE properties ADD COLUMN bedrooms INTEGER;
ALTER TABLE properties ADD COLUMN full_baths INTEGER;
ALTER TABLE properties ADD COLUMN half_baths INTEGER;
ALTER TABLE properties ADD COLUMN stories INTEGER;
ALTER TABLE properties ADD COLUMN beds INTEGER;
ALTER TABLE properties ADD COLUMN pets TEXT NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN internal_notes TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_properties_customer_status
  ON properties(customer_id, status, is_primary);
