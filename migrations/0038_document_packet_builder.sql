-- Owner-controlled document packet builder.
-- Additive only. Approved template content remains immutable; edits are made on
-- drafts, and a completed signing request stores its exact resolved snapshot.

PRAGMA foreign_keys = ON;

ALTER TABLE document_templates ADD COLUMN family_key TEXT NOT NULL DEFAULT '';
ALTER TABLE document_templates ADD COLUMN effective_date TEXT;
ALTER TABLE document_templates ADD COLUMN legal_review_status TEXT NOT NULL DEFAULT 'not_reviewed';
ALTER TABLE document_templates ADD COLUMN supersedes_template_id TEXT REFERENCES document_templates(id) ON DELETE SET NULL;
ALTER TABLE document_templates ADD COLUMN restored_at TEXT;
ALTER TABLE document_templates ADD COLUMN packet_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE document_bundles ADD COLUMN purpose TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE document_bundles ADD COLUMN packet_type TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE document_bundles ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE document_bundles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE document_bundles ADD COLUMN archived_at TEXT;

ALTER TABLE signing_requests ADD COLUMN packet_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE signing_requests ADD COLUMN packet_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_document_templates_family ON document_templates(family_key, created_at);
CREATE INDEX IF NOT EXISTS idx_document_bundles_purpose ON document_bundles(purpose, status);
CREATE INDEX IF NOT EXISTS idx_signing_requests_status_created ON signing_requests(status, created_at);

-- Reusable packet starters. They contain no templates until the owner adds
-- owner-approved documents, so they cannot create a signing requirement.
INSERT OR IGNORE INTO document_bundles
  (id, code, name, description, service_category, subject_type, status, version, purpose, packet_type, instructions, is_system)
VALUES
  ('packet_first_time_customer', 'packet.first_time_customer', 'First-Time Customer Packet', 'Intake, service agreement and privacy acknowledgment for a new customer.', 'packet', 'customer', 'active', 1, 'customer', 'first_time_customer', 'Review every document before signing. Contact Sparkling Standard with any question.', 1),
  ('packet_residential_one_time', 'packet.residential_one_time', 'Residential One-Time Packet', 'One-time residential cleaning agreement, access authorization and optional consent forms.', 'packet', 'customer', 'active', 1, 'customer', 'residential_one_time', 'This packet covers a single residential cleaning visit.', 1),
  ('packet_recurring_residential', 'packet.recurring_residential', 'Recurring Residential Packet', 'Recurring residential cleaning agreement and recurring payment authorization when applicable.', 'packet', 'customer', 'active', 1, 'customer', 'recurring_residential', 'This packet covers an ongoing residential cleaning arrangement. The first visit is a Deep Cleaning.', 1),
  ('packet_move_in_out', 'packet.move_in_out', 'Move-In / Move-Out Packet', 'Move-in or move-out service agreement with access and add-on authorization.', 'packet', 'customer', 'active', 1, 'customer', 'move_in_out', 'This packet covers a move-in or move-out cleaning.', 1),
  ('packet_commercial_client', 'packet.commercial_client', 'Commercial Client Packet', 'Commercial service agreement, facility access authorization and service schedule.', 'packet', 'customer', 'active', 1, 'customer', 'commercial_client', 'This packet covers commercial or church facility cleaning.', 1),
  ('packet_employee_onboarding', 'packet.employee_onboarding', 'Employee Onboarding Packet', 'Handbook acknowledgment, confidentiality, privacy and equipment responsibility.', 'packet', 'employee', 'active', 1, 'employee', 'employee_onboarding', 'Complete every required acknowledgment before beginning work.', 1);
