-- Employee administration, onboarding, training, quality and payroll calculation.
-- Payroll is calculation and approval only; no disbursement or tax filing.

ALTER TABLE team_members ADD COLUMN emergency_contact_name TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN emergency_contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN hire_date TEXT;
ALTER TABLE team_members ADD COLUMN handbook_acknowledged_at TEXT;
ALTER TABLE team_members ADD COLUMN personnel_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN license_expires_on TEXT;
ALTER TABLE team_members ADD COLUMN work_authorization_expires_on TEXT;

CREATE TABLE IF NOT EXISTS employee_onboarding_tasks (
  id TEXT PRIMARY KEY,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','waived')),
  due_date TEXT,
  completed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employee_onboarding_member
  ON employee_onboarding_tasks(team_member_id, status);

CREATE TABLE IF NOT EXISTS training_modules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  content_text TEXT NOT NULL DEFAULT '',
  assessment_json TEXT NOT NULL DEFAULT '[]',
  version TEXT NOT NULL DEFAULT '1.0',
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_assignments (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES training_modules(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','completed','expired','waived')),
  assigned_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  score INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (module_id, team_member_id)
);
CREATE INDEX IF NOT EXISTS idx_training_assignments_member
  ON training_assignments(team_member_id, status);

CREATE TABLE IF NOT EXISTS quality_inspections (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  inspector_team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  inspected_at TEXT NOT NULL,
  score INTEGER,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  findings TEXT NOT NULL DEFAULT '',
  corrective_actions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','follow_up')),
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_date
  ON quality_inspections(inspected_at DESC, status);

CREATE TABLE IF NOT EXISTS employee_performance_notes (
  id TEXT PRIMARY KEY,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'coaching'
    CHECK (kind IN ('praise','coaching','corrective','customer_feedback','review')),
  note TEXT NOT NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employee_performance_member
  ON employee_performance_notes(team_member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','calculated','approved','void')),
  calculated_at TEXT,
  approved_at TEXT,
  approved_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period_start, period_end)
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
  regular_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  regular_cents INTEGER NOT NULL DEFAULT 0,
  overtime_cents INTEGER NOT NULL DEFAULT 0,
  adjustments_cents INTEGER NOT NULL DEFAULT 0,
  gross_cents INTEGER NOT NULL DEFAULT 0,
  rate_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','approved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period_id, team_member_id)
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'adjustment'
    CHECK (kind IN ('travel','bonus','deduction','adjustment')),
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_period
  ON payroll_adjustments(period_id, team_member_id);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id TEXT PRIMARY KEY,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  reviewed_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_member
  ON time_off_requests(team_member_id, status, start_at);
