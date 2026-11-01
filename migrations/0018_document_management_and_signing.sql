-- Owner-controlled document templates, bundles, signing requests and immutable
-- signature evidence. Additive only. Draft templates never satisfy a gate.

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  source_kind TEXT NOT NULL DEFAULT 'text' CHECK (source_kind IN ('text','pdf')),
  content_text TEXT NOT NULL DEFAULT '',
  content_sha256 TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  signer_party TEXT NOT NULL DEFAULT 'customer' CHECK (signer_party IN ('customer','employee','both')),
  requires_countersignature INTEGER NOT NULL DEFAULT 0 CHECK (requires_countersignature IN (0,1)),
  requires_verification INTEGER NOT NULL DEFAULT 0 CHECK (requires_verification IN (0,1)),
  approved_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TEXT,
  archived_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (title, version)
);
CREATE INDEX IF NOT EXISTS idx_document_templates_status ON document_templates(status, category);

CREATE TABLE IF NOT EXISTS document_bundles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  service_category TEXT NOT NULL DEFAULT 'general',
  subject_type TEXT NOT NULL DEFAULT 'customer' CHECK (subject_type IN ('customer','employee')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_bundle_items (
  bundle_id TEXT NOT NULL REFERENCES document_bundles(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES document_templates(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  enforcement_stage TEXT NOT NULL DEFAULT 'before_confirmation'
    CHECK (enforcement_stage IN ('before_payment','before_confirmation','before_employee_activation','optional')),
  condition_key TEXT NOT NULL DEFAULT '',
  condition_value TEXT NOT NULL DEFAULT '',
  per_booking INTEGER NOT NULL DEFAULT 0 CHECK (per_booking IN (0,1)),
  PRIMARY KEY (bundle_id, template_id)
);

CREATE TABLE IF NOT EXISTS signing_requests (
  id TEXT PRIMARY KEY,
  bundle_id TEXT REFERENCES document_bundles(id) ON DELETE SET NULL,
  bundle_code TEXT NOT NULL DEFAULT '',
  bundle_version INTEGER NOT NULL DEFAULT 1,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('customer','employee')),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  booking_request_id TEXT REFERENCES booking_requests(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  recurring_plan_id TEXT REFERENCES recurring_plans(id) ON DELETE SET NULL,
  booking_reference TEXT NOT NULL DEFAULT '',
  service_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','partially_signed','signed','expired','void')),
  requirement_snapshot_json TEXT NOT NULL DEFAULT '[]',
  token_hash TEXT UNIQUE,
  token_expires_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_signing_requests_customer
  ON signing_requests(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_signing_requests_employee
  ON signing_requests(team_member_id, status);
CREATE INDEX IF NOT EXISTS idx_signing_requests_booking
  ON signing_requests(booking_reference, status);
CREATE INDEX IF NOT EXISTS idx_signing_requests_token
  ON signing_requests(token_hash);

CREATE TABLE IF NOT EXISTS document_signatures (
  id TEXT PRIMARY KEY,
  signing_request_id TEXT NOT NULL REFERENCES signing_requests(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES document_templates(id) ON DELETE RESTRICT,
  template_version TEXT NOT NULL,
  document_sha256 TEXT NOT NULL,
  signed_content_text TEXT NOT NULL DEFAULT '',
  signer_party TEXT NOT NULL CHECK (signer_party IN ('customer','employee')),
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL DEFAULT '',
  signature_json TEXT NOT NULL DEFAULT '{}',
  consent_version TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  signed_ip_hash TEXT,
  signed_user_agent_hash TEXT,
  status TEXT NOT NULL DEFAULT 'signed'
    CHECK (status IN ('signed','awaiting_verification','verified','rejected')),
  verified_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  verified_at TEXT,
  rejection_reason TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (signing_request_id, template_id, template_version)
);
CREATE INDEX IF NOT EXISTS idx_document_signatures_template
  ON document_signatures(template_id, template_version, status);
CREATE INDEX IF NOT EXISTS idx_document_signatures_signer
  ON document_signatures(signer_email, signed_at);
