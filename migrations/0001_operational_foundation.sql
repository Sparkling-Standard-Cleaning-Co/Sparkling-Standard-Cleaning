-- Sparkling Standard operational foundation (Milestone 3).
-- Non-destructive schema only. No production binding is activated by this file.
-- Apply with: npx wrangler d1 migrations apply <database> --remote

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  address_line1 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'FL',
  postal_code TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admin_permissions (
  permission TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id TEXT NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL REFERENCES admin_permissions(permission) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  role_id TEXT NOT NULL REFERENCES admin_roles(id) ON DELETE RESTRICT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  mfa_secret TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0,1)),
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  primary_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  source TEXT NOT NULL DEFAULT '',
  notes_summary TEXT NOT NULL DEFAULT '',
  do_not_contact INTEGER NOT NULL DEFAULT 0 CHECK (do_not_contact IN (0,1)),
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email','phone')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, normalized_value)
);

CREATE TABLE IF NOT EXISTS customer_notes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','private')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_consents (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  evidence_r2_key TEXT
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  line1 TEXT NOT NULL,
  line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'FL',
  postal_code TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  precision TEXT NOT NULL DEFAULT 'exact' CHECK (precision IN ('exact','street','approximate','zip')),
  access_notes TEXT NOT NULL DEFAULT '',
  parking_notes TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','quoted','converted','lost','archived')),
  source TEXT NOT NULL DEFAULT '',
  quote_reference TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  outstanding_requirement TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  taxable INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS estimates (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  service_code TEXT REFERENCES services(code) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quoted','accepted','expired','void')),
  source TEXT NOT NULL DEFAULT '',
  quote_reference TEXT NOT NULL DEFAULT '',
  input_snapshot_json TEXT NOT NULL DEFAULT '{}',
  pricing_version TEXT NOT NULL DEFAULT '',
  labor_hours REAL,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS estimate_lines (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('base','extra','discount','travel','tax','rounding','credit')),
  label TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recurring_plans (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  service_code TEXT REFERENCES services(code) ON DELETE SET NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','completed')),
  ongoing_price_cents INTEGER NOT NULL DEFAULT 0,
  first_visit_estimate_id TEXT REFERENCES estimates(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,
  next_visit_date TEXT,
  terms_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined','released','expired')),
  quote_reference TEXT NOT NULL DEFAULT '',
  requested_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_holds (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES booking_requests(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','confirmed','expired','released')),
  quote_reference TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  recurring_plan_id TEXT REFERENCES recurring_plans(id) ON DELETE SET NULL,
  estimate_id TEXT REFERENCES estimates(id) ON DELETE SET NULL,
  booking_request_id TEXT REFERENCES booking_requests(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled','no_show')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  duration_minutes INTEGER NOT NULL,
  crew_size INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS appointment_resources (
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'cleaner',
  PRIMARY KEY (appointment_id, team_member_id)
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  is_bookable INTEGER NOT NULL DEFAULT 1 CHECK (is_bookable IN (0,1)),
  color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_availability (
  id TEXT PRIMARY KEY,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT
);

CREATE TABLE IF NOT EXISTS team_time_off (
  id TEXT PRIMARY KEY,
  team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS calendar_links (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',
  provider_event_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed','deleted')),
  last_synced_at TEXT,
  error_detail TEXT NOT NULL DEFAULT '',
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS job_checklists (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  completed_at TEXT,
  completed_by_team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS job_checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES job_checklists(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  completed_at TEXT,
  completed_by_team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_media (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('before','after','issue','document')),
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT '',
  uploaded_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','partially_paid','void','overdue')),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  tax_snapshot_json TEXT NOT NULL DEFAULT '{}',
  terms_version TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service','extra','discount','tax','credit','adjustment')),
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_counters (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1001
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','cash','check','external')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded','void')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_customer_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_event_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','notified','failed','incomplete')),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  stripe_refund_id TEXT UNIQUE,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credits (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT '',
  original_amount_cents INTEGER NOT NULL,
  remaining_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','expired','void')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_applications (
  id TEXT PRIMARY KEY,
  credit_id TEXT NOT NULL REFERENCES credits(id) ON DELETE RESTRICT,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_payment_methods (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_payment_method_id TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL DEFAULT '',
  last4 TEXT NOT NULL DEFAULT '',
  exp_month INTEGER,
  exp_year INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  consent_id TEXT REFERENCES payment_method_consents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_method_consents (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  evidence_r2_key TEXT,
  ip_hash TEXT
);

CREATE TABLE IF NOT EXISTS gift_certificates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  purchaser_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  recipient_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fully_redeemed','refunded','void')),
  value_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  valid_from_date TEXT,
  activates_at TEXT,
  stripe_event_id TEXT,
  stripe_session_id TEXT,
  terms_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gift_transactions (
  id TEXT PRIMARY KEY,
  gift_certificate_id TEXT NOT NULL REFERENCES gift_certificates(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('issue','redeem','reserve','release','refund','void','adjustment')),
  amount_cents INTEGER NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agreements (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  template_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','signed','void')),
  signed_at TEXT,
  signed_r2_key TEXT,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS communications (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','phone','in_person','system')),
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound')),
  template TEXT NOT NULL DEFAULT '',
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','received')),
  subject TEXT NOT NULL DEFAULT '',
  body_r2_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reconciliation_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('matched','unmatched','exception','resolved')),
  reference TEXT NOT NULL DEFAULT '',
  provider_reference TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers(primary_branch_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_properties_customer ON properties(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_estimates_customer ON estimates(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recurring_customer ON recurring_plans(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at, status);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id, start_at);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_gift_code ON gift_certificates(code);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, available_at);
