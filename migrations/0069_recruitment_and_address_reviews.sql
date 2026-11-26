-- Recruitment expansion, applicant pipeline and address review requests.
-- Additive only. Existing career applications and employee records are preserved.

CREATE TABLE IF NOT EXISTS address_review_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'resolved', 'dismissed')),
  address_text TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  detected_business_name TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT 'commercial',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  admin_notes TEXT NOT NULL DEFAULT '',
  reviewed_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_address_review_status
  ON address_review_requests(status, created_at DESC);

ALTER TABLE career_applications ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN position_code TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN earliest_start_date TEXT;
ALTER TABLE career_applications ADD COLUMN available_days_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE career_applications ADD COLUMN availability_morning INTEGER NOT NULL DEFAULT 0 CHECK (availability_morning IN (0,1));
ALTER TABLE career_applications ADD COLUMN availability_afternoon INTEGER NOT NULL DEFAULT 0 CHECK (availability_afternoon IN (0,1));
ALTER TABLE career_applications ADD COLUMN availability_evening INTEGER NOT NULL DEFAULT 0 CHECK (availability_evening IN (0,1));
ALTER TABLE career_applications ADD COLUMN availability_weekend INTEGER NOT NULL DEFAULT 0 CHECK (availability_weekend IN (0,1));
ALTER TABLE career_applications ADD COLUMN desired_weekly_hours INTEGER;
ALTER TABLE career_applications ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'either'
  CHECK (employment_type IN ('full_time','part_time','either'));
ALTER TABLE career_applications ADD COLUMN residential_experience INTEGER NOT NULL DEFAULT 0 CHECK (residential_experience IN (0,1));
ALTER TABLE career_applications ADD COLUMN commercial_experience INTEGER NOT NULL DEFAULT 0 CHECK (commercial_experience IN (0,1));
ALTER TABLE career_applications ADD COLUMN str_experience INTEGER NOT NULL DEFAULT 0 CHECK (str_experience IN (0,1));
ALTER TABLE career_applications ADD COLUMN supervisory_experience INTEGER NOT NULL DEFAULT 0 CHECK (supervisory_experience IN (0,1));
ALTER TABLE career_applications ADD COLUMN qualifications TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN essential_duties_ack INTEGER NOT NULL DEFAULT 0 CHECK (essential_duties_ack IN (0,1));
ALTER TABLE career_applications ADD COLUMN additional_information TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN branch_id TEXT;
ALTER TABLE career_applications ADD COLUMN pipeline_status TEXT NOT NULL DEFAULT 'new'
  CHECK (pipeline_status IN (
    'new','under_review','interview_requested','interview_scheduled',
    'interview_completed','selected','onboarding','hired','not_selected',
    'withdrawn','archived'
  ));
ALTER TABLE career_applications ADD COLUMN privacy_ack_at TEXT;
ALTER TABLE career_applications ADD COLUMN accuracy_ack_at TEXT;
ALTER TABLE career_applications ADD COLUMN contact_consent_at TEXT;
ALTER TABLE career_applications ADD COLUMN interview_at TEXT;
ALTER TABLE career_applications ADD COLUMN interview_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN follow_up_at TEXT;
ALTER TABLE career_applications ADD COLUMN converted_team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE career_applications ADD COLUMN hired_at TEXT;
ALTER TABLE career_applications ADD COLUMN archived_at TEXT;

UPDATE career_applications SET
  branch_id = CASE branch_preference
    WHEN 'pensacola' THEN 'branch_pensacola'
    WHEN 'tampa' THEN 'branch_tampa'
    ELSE NULL
  END,
  position_code = desired_role,
  first_name = CASE
    WHEN instr(name, ' ') > 0 THEN substr(name, 1, instr(name, ' ') - 1)
    ELSE name
  END,
  last_name = CASE
    WHEN instr(name, ' ') > 0 THEN substr(name, instr(name, ' ') + 1)
    ELSE ''
  END,
  pipeline_status = CASE status
    WHEN 'reviewing' THEN 'under_review'
    WHEN 'interview' THEN 'interview_scheduled'
    WHEN 'offer' THEN 'selected'
    WHEN 'declined' THEN 'not_selected'
    WHEN 'archived' THEN 'archived'
    ELSE 'new'
  END
WHERE pipeline_status = 'new';

CREATE INDEX IF NOT EXISTS idx_career_applications_pipeline
  ON career_applications(pipeline_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_applications_branch
  ON career_applications(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_applications_position
  ON career_applications(position_code, created_at DESC);

CREATE TABLE IF NOT EXISTS recruitment_opportunities (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'cleaning',
  status TEXT NOT NULL DEFAULT 'future'
    CHECK (status IN ('open','future','closed')),
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (branch_id, code)
);
CREATE INDEX IF NOT EXISTS idx_recruitment_opportunities_status
  ON recruitment_opportunities(branch_id, status, sort_order);

INSERT OR IGNORE INTO recruitment_opportunities
  (id, branch_id, code, title, category, status, description, sort_order)
VALUES
  ('opp_pen_residential', 'branch_pensacola', 'residential', 'Residential Cleaning Specialist', 'cleaning', 'open',
   'Recurring and deep cleaning for residential customers.', 10),
  ('opp_pen_commercial', 'branch_pensacola', 'commercial', 'Commercial Cleaning Specialist', 'cleaning', 'future',
   'Scheduled cleaning for offices, facilities and commercial accounts.', 20),
  ('opp_pen_str', 'branch_pensacola', 'str', 'Vacation Rental Cleaning Specialist', 'cleaning', 'future',
   'Turnover cleaning for short-term rental properties.', 30),
  ('opp_pen_lead', 'branch_pensacola', 'lead', 'Lead Cleaner', 'leadership', 'future',
   'Crew leadership, quality checks and customer-facing service.', 40),
  ('opp_pen_management', 'branch_pensacola', 'management', 'Future Management Opportunities', 'management', 'future',
   'Future operations and team leadership roles as the company grows.', 50),
  ('opp_tpa_residential', 'branch_tampa', 'residential', 'Residential Cleaning Specialist', 'cleaning', 'future',
   'Future Tampa Bay interest only. The branch is not publicly operational.', 10),
  ('opp_tpa_commercial', 'branch_tampa', 'commercial', 'Commercial Cleaning Specialist', 'cleaning', 'future',
   'Future Tampa Bay interest only. The branch is not publicly operational.', 20),
  ('opp_tpa_str', 'branch_tampa', 'str', 'Vacation Rental Cleaning Specialist', 'cleaning', 'future',
   'Future Tampa Bay interest only. The branch is not publicly operational.', 30),
  ('opp_tpa_lead', 'branch_tampa', 'lead', 'Lead Cleaner', 'leadership', 'future',
   'Future Tampa Bay interest only. The branch is not publicly operational.', 40),
  ('opp_tpa_management', 'branch_tampa', 'management', 'Future Management Opportunities', 'management', 'future',
   'Future Tampa Bay interest only. The branch is not publicly operational.', 50);

CREATE TABLE IF NOT EXISTS career_interview_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
  scheduled_at TEXT,
  interviewer TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_career_interviews_application
  ON career_interview_events(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recruitment_settings (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  pay_regular_cents INTEGER NOT NULL DEFAULT 1800,
  pay_lead_cents INTEGER NOT NULL DEFAULT 2200,
  pay_solo_cents INTEGER NOT NULL DEFAULT 2500,
  updated_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO recruitment_settings
  (branch_id, pay_regular_cents, pay_lead_cents, pay_solo_cents)
VALUES
  ('branch_pensacola', 1800, 2200, 2500),
  ('branch_tampa', 1800, 2200, 2500);
