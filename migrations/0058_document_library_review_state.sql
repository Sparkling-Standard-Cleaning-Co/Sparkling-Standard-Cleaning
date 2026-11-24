-- Document library consolidation and customer-level review suppression.
--
-- Additive and non-destructive. Executed agreements, signatures, signing
-- requests and historical template versions are preserved unchanged.
--
-- document_family_state stores owner archiving for a document family. It never
-- changes template status or executed evidence; it only controls whether the
-- family appears in the normal active library.
--
-- customer_review_state stores one authoritative review relationship per
-- customer so completed repeat cleanings do not generate repetitive review
-- invitations. Delivery history remains in review_requests.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS document_family_state (
  family_key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  archived_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_family_state_archived
  ON document_family_state(archived_at);

CREATE TABLE IF NOT EXISTS customer_review_state (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'never_invited'
    CHECK (status IN (
      'never_invited','queued','sent','failed','unknown',
      'reviewed','do_not_ask','opted_out'
    )),
  invitation_count INTEGER NOT NULL DEFAULT 0,
  last_invited_at TEXT,
  last_request_id TEXT,
  marked_reviewed_at TEXT,
  marked_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'owner',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_review_state_status
  ON customer_review_state(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_review_state_branch
  ON customer_review_state(branch_id, status);
