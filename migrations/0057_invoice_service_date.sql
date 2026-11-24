-- Add the service performed date separately from invoice issue/due dates.
-- Additive: existing invoices remain valid with an empty service date.

ALTER TABLE invoices ADD COLUMN service_code TEXT;
ALTER TABLE invoices ADD COLUMN service_date TEXT;
ALTER TABLE invoices ADD COLUMN service_label TEXT;
