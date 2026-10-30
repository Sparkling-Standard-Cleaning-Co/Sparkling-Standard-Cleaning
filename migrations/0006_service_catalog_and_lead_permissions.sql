-- Sparkling Standard service catalog and lead permissions used by administration.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO services (code, name, category, taxable, active) VALUES
  ('standard', 'Residential Cleaning', 'residential', 1, 1),
  ('deep', 'Deep Cleaning', 'residential', 1, 1),
  ('move_in_out', 'Move-in and Move-out Cleaning', 'residential', 1, 1),
  ('str_turnover', 'Short-Term Rental Turnover', 'str', 1, 1),
  ('commercial-cleaning', 'Commercial Cleaning', 'commercial', 1, 1),
  ('church-cleaning', 'Church Cleaning', 'church', 0, 1),
  ('residential-cleaning', 'Residential Cleaning', 'residential', 1, 1);

INSERT OR IGNORE INTO admin_permissions (permission, description) VALUES
  ('lead.write', 'Update lead status and request follow-up actions');

INSERT OR IGNORE INTO admin_role_permissions (role_id, permission) VALUES
  ('owner', 'lead.write'),
  ('manager', 'lead.write'),
  ('finance', 'lead.read');
