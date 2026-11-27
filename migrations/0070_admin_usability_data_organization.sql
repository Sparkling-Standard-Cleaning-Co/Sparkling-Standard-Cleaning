-- Administrative usability and data organization.
--
-- Additive only. Existing leads, properties, appointments and financial
-- records are preserved. Classification columns make test and duplicate
-- inquiries explicit without inventing a second lead or property store.

ALTER TABLE leads ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1));
ALTER TABLE leads ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0 CHECK (is_duplicate IN (0,1));
ALTER TABLE leads ADD COLUMN duplicate_of_lead_id TEXT;
ALTER TABLE leads ADD COLUMN previous_status TEXT;
ALTER TABLE leads ADD COLUMN archived_at TEXT;
ALTER TABLE leads ADD COLUMN test_marked_at TEXT;
ALTER TABLE leads ADD COLUMN test_marked_by_admin_user_id TEXT
  REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_test_status
  ON leads(is_test, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_duplicate_status
  ON leads(is_duplicate, status, created_at DESC);

-- Residential properties remain the default. A facility is an explicitly
-- commercial/church property or one already linked to commercial records.
ALTER TABLE properties ADD COLUMN usage_type TEXT NOT NULL DEFAULT 'residential'
  CHECK (usage_type IN ('residential','facility'));

CREATE INDEX IF NOT EXISTS idx_properties_usage_status
  ON properties(usage_type, status, customer_id);
