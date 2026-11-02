-- A rejected signature must remain as evidence while allowing a new attempt.
CREATE TABLE document_signatures_new (
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
  attempt INTEGER NOT NULL DEFAULT 1,
  UNIQUE (signing_request_id, template_id, template_version, attempt)
);

INSERT INTO document_signatures_new
  (id, signing_request_id, template_id, template_version, document_sha256,
   signed_content_text, signer_party, signer_name, signer_email, signature_json,
   consent_version, signed_at, signed_ip_hash, signed_user_agent_hash, status,
   verified_by_admin_user_id, verified_at, rejection_reason, r2_key, created_at, attempt)
SELECT
  id, signing_request_id, template_id, template_version, document_sha256,
  signed_content_text, signer_party, signer_name, signer_email, signature_json,
  consent_version, signed_at, signed_ip_hash, signed_user_agent_hash, status,
  verified_by_admin_user_id, verified_at, rejection_reason, r2_key, created_at, 1
FROM document_signatures;

DROP TABLE document_signatures;
ALTER TABLE document_signatures_new RENAME TO document_signatures;

CREATE INDEX IF NOT EXISTS idx_document_signatures_template
  ON document_signatures(template_id, template_version, status);
CREATE INDEX IF NOT EXISTS idx_document_signatures_signer
  ON document_signatures(signer_email, signed_at);
CREATE INDEX IF NOT EXISTS idx_document_signatures_attempt
  ON document_signatures(signing_request_id, template_id, attempt);
