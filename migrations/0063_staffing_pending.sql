-- Owner-directed mandatory additional-crew workflow (2026-11-25).
--
-- A paid or requested booking whose required crew cannot yet be assigned stays
-- visible as staffing-pending. The appointment time and financial records are
-- preserved; management must acknowledge the warning and secure the crew.
ALTER TABLE appointments ADD COLUMN staffing_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN staffing_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_appointments_staffing_pending
  ON appointments(staffing_pending, start_at);
