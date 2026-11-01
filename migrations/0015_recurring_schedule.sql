-- Recurring plan appointment window and duration.
ALTER TABLE recurring_plans ADD COLUMN window TEXT CHECK (window IN ('morning','afternoon'));
ALTER TABLE recurring_plans ADD COLUMN start_time TEXT;
ALTER TABLE recurring_plans ADD COLUMN duration_minutes INTEGER;
ALTER TABLE recurring_plans ADD COLUMN crew_size INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recurring_plans ADD COLUMN first_duration_minutes INTEGER;
CREATE TABLE IF NOT EXISTS recurring_occurrences (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES recurring_plans(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (plan_id, occurrence_date)
);
