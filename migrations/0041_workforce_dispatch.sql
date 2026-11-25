-- Commercial dispatch profiles, owner controls and explainable assignment history.
-- Additive only: existing team, booking, recurring and calendar records are preserved.

ALTER TABLE team_members ADD COLUMN dispatch_services_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE team_members ADD COLUMN dispatch_equipment_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE team_members ADD COLUMN dispatch_transport_mode TEXT NOT NULL DEFAULT 'unknown'
  CHECK (dispatch_transport_mode IN ('independent','shared','none','unknown'));
ALTER TABLE team_members ADD COLUMN dispatch_can_drive INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_can_drive IN (0,1));
ALTER TABLE team_members ADD COLUMN dispatch_vehicle_seats INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_members ADD COLUMN dispatch_can_transport_equipment INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_can_transport_equipment IN (0,1));
ALTER TABLE team_members ADD COLUMN dispatch_max_weekly_hours REAL NOT NULL DEFAULT 40;
ALTER TABLE team_members ADD COLUMN dispatch_overtime_approved INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_overtime_approved IN (0,1));
ALTER TABLE team_members ADD COLUMN dispatch_origin_address TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN dispatch_origin_lat REAL;
ALTER TABLE team_members ADD COLUMN dispatch_origin_lng REAL;
ALTER TABLE team_members ADD COLUMN dispatch_origin_place_id TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN dispatch_alt_origin_address TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN dispatch_alt_origin_lat REAL;
ALTER TABLE team_members ADD COLUMN dispatch_alt_origin_lng REAL;
ALTER TABLE team_members ADD COLUMN dispatch_alt_origin_place_id TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN dispatch_alt_origin_starts_at TEXT;
ALTER TABLE team_members ADD COLUMN dispatch_alt_origin_ends_at TEXT;
ALTER TABLE team_members ADD COLUMN dispatch_notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS dispatch_shift_overrides (
  id TEXT PRIMARY KEY,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (team_member_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_shift_overrides_date
  ON dispatch_shift_overrides(work_date, team_member_id);

CREATE TABLE IF NOT EXISTS dispatch_settings (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  automation_mode TEXT NOT NULL DEFAULT 'analysis_only'
    CHECK (automation_mode IN ('analysis_only','automatic_unassigned')),
  auto_assign_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_assign_enabled IN (0,1)),
  reassignment_recommendations INTEGER NOT NULL DEFAULT 1 CHECK (reassignment_recommendations IN (0,1)),
  customer_rescheduling_recommendations INTEGER NOT NULL DEFAULT 0 CHECK (customer_rescheduling_recommendations IN (0,1)),
  paused INTEGER NOT NULL DEFAULT 1 CHECK (paused IN (0,1)),
  min_savings_cents INTEGER NOT NULL DEFAULT 1500,
  max_candidates INTEGER NOT NULL DEFAULT 8,
  weights_json TEXT NOT NULL DEFAULT '{"travel":1,"miles":0.2,"labor":0.1,"workload":0.5,"continuity":12,"shared":0}',
  vehicle_cost_cents_per_mile INTEGER NOT NULL DEFAULT 0,
  travel_pay_percent INTEGER NOT NULL DEFAULT 0,
  lock_owner TEXT NOT NULL DEFAULT '',
  lock_expires_at TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO dispatch_settings (branch_id) SELECT id FROM branches;

CREATE TABLE IF NOT EXISTS dispatch_decisions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('auto_assignment','recommendation','coverage_exception','manual_reassignment')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','applied','rejected','deferred','dismissed','blocked','superseded')),
  current_team_json TEXT NOT NULL DEFAULT '[]',
  chosen_team_json TEXT NOT NULL DEFAULT '[]',
  candidates_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  score_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  schedule_version TEXT NOT NULL DEFAULT '',
  calendar_status TEXT NOT NULL DEFAULT 'not_requested',
  actor_user_id TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dispatch_decisions_branch_created
  ON dispatch_decisions(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_decisions_appointment
  ON dispatch_decisions(appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_decisions_status
  ON dispatch_decisions(branch_id, status, created_at DESC);
