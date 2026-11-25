-- One authoritative primary invoice per job.
--
-- Additional financial documents must be explicitly recorded as supplemental
-- invoices, credits, refunds or corrections. Existing invoices remain primary.
-- The partial index permits any number of supplemental invoices and blocks a
-- second primary invoice for the same appointment.

PRAGMA foreign_keys = ON;

ALTER TABLE invoices ADD COLUMN invoice_role TEXT NOT NULL DEFAULT 'primary'
  CHECK (invoice_role IN ('primary', 'supplemental'));
ALTER TABLE invoices ADD COLUMN related_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_primary_per_appointment
  ON invoices(appointment_id)
  WHERE appointment_id IS NOT NULL AND invoice_role = 'primary';

CREATE INDEX IF NOT EXISTS idx_invoices_appointment_role
  ON invoices(appointment_id, invoice_role);
