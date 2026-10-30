-- Cleaners receive job and booking access, not customer CRM profiles.
PRAGMA foreign_keys = ON;
DELETE FROM admin_role_permissions
WHERE role_id = 'cleaner' AND permission = 'customer.read';
