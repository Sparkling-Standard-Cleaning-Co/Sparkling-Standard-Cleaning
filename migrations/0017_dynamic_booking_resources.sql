-- Dynamic employee capacity, staff qualifications and invitation linkage.
-- Additive only. Hayli keeps the historical booking resource id "hayli".

ALTER TABLE team_members ADD COLUMN booking_resource_id TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN is_solo INTEGER NOT NULL DEFAULT 0 CHECK (is_solo IN (0,1));
ALTER TABLE team_members ADD COLUMN is_lead INTEGER NOT NULL DEFAULT 0 CHECK (is_lead IN (0,1));
ALTER TABLE team_members ADD COLUMN workdays TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6';
ALTER TABLE team_members ADD COLUMN workday_start TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE team_members ADD COLUMN workday_end TEXT NOT NULL DEFAULT '18:00';

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_booking_resource
  ON team_members(booking_resource_id) WHERE booking_resource_id <> '';

ALTER TABLE admin_invitations ADD COLUMN team_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL;

ALTER TABLE recurring_plans ADD COLUMN booking_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE recurring_plans ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE recurring_plans ADD COLUMN sync_error TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_plans_booking_reference
  ON recurring_plans(booking_reference) WHERE booking_reference <> '';

-- Hayli is the existing owner account and the only confirmed bookable cleaner.
-- The owner account may not exist yet on a fresh install; the application links
-- it by email at enrollment/availability time without creating a second login.
INSERT INTO team_members
  (id, branch_id, admin_user_id, display_name, email, status, is_bookable,
   booking_resource_id, is_solo, is_lead, default_rate_type,
   pay_rate_regular_cents, pay_rate_lead_cents, pay_rate_solo_cents)
SELECT
  'team_hayli', 'branch_pensacola',
  (SELECT id FROM admin_users WHERE lower(email) = 'owner@sparkling-standard.com' LIMIT 1),
  'Hayli', 'owner@sparkling-standard.com', 'active', 1,
  'hayli', 1, 1, 'regular', 1800, 2200, 2500
WHERE NOT EXISTS (
  SELECT 1 FROM team_members
  WHERE booking_resource_id = 'hayli' OR lower(email) = 'owner@sparkling-standard.com'
);

-- Historical assignments were stored as generic "cleaner". Mark the qualified
-- anchor so the employee portal can decide visibility from the actual job role.
UPDATE appointment_resources
SET role = 'solo'
WHERE team_member_id IN (SELECT id FROM team_members WHERE is_solo = 1);

CREATE INDEX IF NOT EXISTS idx_team_members_bookable
  ON team_members(status, is_bookable, booking_resource_id);
