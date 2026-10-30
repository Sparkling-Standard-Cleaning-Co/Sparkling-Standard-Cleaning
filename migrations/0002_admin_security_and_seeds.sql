-- Sparkling Standard only: admin rate limiting, lead idempotency, roles and
-- the approved cleaning-company branches. No multi-business schema.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_rate_limits (
  scope_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE leads ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_idempotency ON leads(idempotency_key);

INSERT OR IGNORE INTO branches (id, name, timezone, city, state, phone, status)
VALUES
  ('branch_pensacola', 'Pensacola', 'America/Chicago', 'Cantonment', 'FL', '(850) 426-8479', 'active'),
  ('branch_tampa', 'Tampa Bay (future)', 'America/New_York', 'Tampa', 'FL', '', 'inactive');

INSERT OR IGNORE INTO admin_roles (id, name, description) VALUES
  ('owner', 'Owner', 'Full Sparkling Standard administration'),
  ('manager', 'Manager', 'Assigned branch customers, scheduling and jobs'),
  ('finance', 'Finance', 'Invoices, payments, refunds and financial reporting'),
  ('cleaner', 'Cleaner', 'Assigned jobs, checklists and permitted instructions');

INSERT OR IGNORE INTO admin_permissions (permission, description) VALUES
  ('admin.manage', 'Manage administrators and roles'),
  ('customer.read', 'Read customer records'),
  ('customer.write', 'Create or edit customer records'),
  ('lead.read', 'Read leads and requests'),
  ('booking.read', 'Read bookings and calendar state'),
  ('booking.write', 'Confirm, reschedule or cancel bookings'),
  ('job.read', 'Read jobs and checklists'),
  ('job.write', 'Update jobs and checklists'),
  ('finance.read', 'Read invoices, payments and gift liabilities'),
  ('finance.write', 'Create invoices, payments, refunds and credits'),
  ('settings.write', 'Change operational settings');

INSERT OR IGNORE INTO admin_role_permissions (role_id, permission)
SELECT 'owner', permission FROM admin_permissions;

INSERT OR IGNORE INTO admin_role_permissions (role_id, permission) VALUES
  ('manager', 'customer.read'),
  ('manager', 'customer.write'),
  ('manager', 'lead.read'),
  ('manager', 'booking.read'),
  ('manager', 'booking.write'),
  ('manager', 'job.read'),
  ('manager', 'job.write'),
  ('manager', 'finance.read'),
  ('finance', 'customer.read'),
  ('finance', 'lead.read'),
  ('finance', 'booking.read'),
  ('finance', 'finance.read'),
  ('finance', 'finance.write'),
  ('cleaner', 'job.read'),
  ('cleaner', 'job.write'),
  ('cleaner', 'booking.read'),
  ('cleaner', 'customer.read');
