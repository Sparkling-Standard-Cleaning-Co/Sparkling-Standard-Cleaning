-- Owner direction 2026-11-25: published operating hours are 7:00 AM-7:00 PM.
-- Public appointment STARTS remain limited to the approved morning/afternoon
-- windows in application code; this only stops the existing owner resource
-- from ending eligible work at 6:00 PM.
UPDATE team_members
SET workday_end = '19:00', updated_at = CURRENT_TIMESTAMP
WHERE workday_end = '18:00'
  AND booking_resource_id = 'hayli';
