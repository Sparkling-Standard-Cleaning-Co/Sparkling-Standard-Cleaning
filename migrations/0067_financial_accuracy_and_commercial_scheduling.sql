-- Financial accuracy and commercial scheduling closeout.
-- Additive only. No historical executed agreement or invoice is rewritten.

-- Timekeeping: travel is compensable time, recorded on the existing interval.
ALTER TABLE time_intervals ADD COLUMN is_travel INTEGER NOT NULL DEFAULT 0
  CHECK (is_travel IN (0, 1));

-- Payroll: branch scope, calculation fingerprint and locking evidence.
ALTER TABLE payroll_periods ADD COLUMN branch_id TEXT
  REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE payroll_periods ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE payroll_periods ADD COLUMN calculated_intervals INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_periods ADD COLUMN calculated_gross_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_payroll_periods_branch
  ON payroll_periods(branch_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_range
  ON payroll_periods(period_start, period_end);

-- Commercial contracts: preserve the accepted proposal snapshot and the
-- amounts needed to reconcile the first and subsequent invoices.
ALTER TABLE commercial_contracts ADD COLUMN one_time_total_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commercial_contracts ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commercial_contracts ADD COLUMN first_invoice_total_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commercial_contracts ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '{}';

UPDATE commercial_contracts
SET one_time_total_cents = COALESCE(
      (SELECT p.one_time_total_cents FROM commercial_proposals p WHERE p.id = commercial_contracts.proposal_id),
      0
    ),
    discount_cents = COALESCE(
      (SELECT p.discount_cents FROM commercial_proposals p WHERE p.id = commercial_contracts.proposal_id),
      0
    ),
    first_invoice_total_cents = COALESCE(
      (SELECT p.first_invoice_total_cents FROM commercial_proposals p WHERE p.id = commercial_contracts.proposal_id),
      0
    ),
    snapshot_json = COALESCE(
      NULLIF((SELECT p.snapshot_json FROM commercial_proposals p WHERE p.id = commercial_contracts.proposal_id), ''),
      '{}'
    )
WHERE snapshot_json = '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_contract_invoices_period
  ON commercial_contract_invoices(contract_id, period_start);

-- Structured commercial service schedules. Free-text proposal terms never
-- create appointments; an administrator confirms these fields.
CREATE TABLE IF NOT EXISTS commercial_contract_schedules (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES commercial_contracts(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  recurring_plan_id TEXT REFERENCES recurring_plans(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'previewed', 'approved', 'active', 'paused', 'cancelled')),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  start_date TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('morning', 'afternoon')),
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  first_duration_minutes INTEGER NOT NULL,
  crew_size INTEGER NOT NULL DEFAULT 1,
  scope_notes TEXT NOT NULL DEFAULT '',
  access_instructions TEXT NOT NULL DEFAULT '',
  required_qualifications TEXT NOT NULL DEFAULT '',
  preview_json TEXT NOT NULL DEFAULT '[]',
  conflicts_json TEXT NOT NULL DEFAULT '[]',
  approved_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_by_admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commercial_schedules_contract
  ON commercial_contract_schedules(contract_id, status, start_date);
CREATE INDEX IF NOT EXISTS idx_commercial_schedules_plan
  ON commercial_contract_schedules(recurring_plan_id);

ALTER TABLE recurring_plans ADD COLUMN commercial_schedule_id TEXT;
ALTER TABLE recurring_plans ADD COLUMN scope_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE recurring_plans ADD COLUMN access_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE recurring_plans ADD COLUMN required_qualifications TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_recurring_plans_commercial
  ON recurring_plans(commercial_schedule_id);
