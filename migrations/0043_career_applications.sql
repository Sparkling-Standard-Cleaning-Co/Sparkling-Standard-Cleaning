-- Secure career applications and resume metadata.
CREATE TABLE IF NOT EXISTS career_applications (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  experience_level TEXT NOT NULL,
  desired_role TEXT NOT NULL,
  branch_preference TEXT NOT NULL,
  availability TEXT NOT NULL,
  transportation TEXT NOT NULL,
  driver_license TEXT NOT NULL DEFAULT 'prefer_not_to_say',
  resume_key TEXT NOT NULL DEFAULT '',
  resume_name TEXT NOT NULL DEFAULT '',
  resume_type TEXT NOT NULL DEFAULT '',
  resume_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','reviewing','interview','offer','declined','archived')),
  notes TEXT NOT NULL DEFAULT '',
  consent_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'careers_page',
  hiring_notified_at TEXT,
  applicant_notified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_career_applications_status_created
  ON career_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_applications_email
  ON career_applications(lower(email), created_at DESC);
