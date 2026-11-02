-- Cleaners use the assignment-scoped employee portal, not the admin console.
-- Remove the remaining admin job/booking permissions from the cleaner role.
-- The server also rejects cleaner sessions from /api/admin/* as defense in depth.

PRAGMA foreign_keys = ON;

DELETE FROM admin_role_permissions
WHERE role_id = 'cleaner'
  AND permission IN ('job.read', 'job.write', 'booking.read');
