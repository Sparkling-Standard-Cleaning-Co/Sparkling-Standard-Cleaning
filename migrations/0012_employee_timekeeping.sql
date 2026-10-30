-- Employee portal timekeeping. Additive only.
-- Worker identity is the existing admin_users account, tied to the existing
-- team_members roster; no duplicate employee or identity system is created.

ALTER TABLE team_members ADD COLUMN pay_rate_regular_cents INTEGER NOT NULL DEFAULT 1800;
ALTER TABLE team_members ADD COLUMN pay_rate_lead_cents INTEGER NOT NULL DEFAULT 2200;
ALTER TABLE team_members ADD COLUMN pay_rate_solo_cents INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE team_members ADD COLUMN default_rate_type TEXT NOT NULL DEFAULT 'regular';

CREATE TABLE IF NOT EXISTS employee_rate_history (
  id TEXT PRIMARY KEY,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('regular', 'lead', 'solo')),
  hourly_cents INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employee_rate_history
  ON employee_rate_history(team_member_id, effective_from);

CREATE TABLE IF NOT EXISTS time_events (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('clock_in', 'start_break', 'end_break', 'start_meal', 'end_meal', 'clock_out')),
  occurred_at TEXT NOT NULL,
  device_time TEXT,
  lat REAL,
  lng REAL,
  accuracy_m REAL,
  location_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (location_status IN ('captured', 'denied', 'unavailable', 'inaccurate', 'not_requested')),
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_time_events_user ON time_events(admin_user_id, occurred_at);

CREATE TABLE IF NOT EXISTS time_intervals (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('work', 'break', 'meal')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('regular', 'lead', 'solo')),
  rate_cents INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1 CHECK (paid IN (0, 1)),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'corrected')),
  start_event_id TEXT REFERENCES time_events(id) ON DELETE SET NULL,
  end_event_id TEXT REFERENCES time_events(id) ON DELETE SET NULL,
  corrected_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  correction_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_time_intervals_user
  ON time_intervals(admin_user_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_intervals_one_open
  ON time_intervals(admin_user_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS time_correction_requests (
  id TEXT PRIMARY KEY,
  interval_id TEXT REFERENCES time_intervals(id) ON DELETE SET NULL,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  requested_started_at TEXT,
  requested_ended_at TEXT,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  reviewed_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_time_correction_requests
  ON time_correction_requests(admin_user_id, created_at);

CREATE TABLE IF NOT EXISTS time_entry_corrections (
  id TEXT PRIMARY KEY,
  interval_id TEXT NOT NULL REFERENCES time_intervals(id) ON DELETE CASCADE,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  corrected_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
