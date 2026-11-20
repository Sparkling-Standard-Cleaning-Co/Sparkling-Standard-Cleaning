-- Branch operating origins and launch readiness inputs.
-- Private origins are owner-only operational coordinates, never public content.
ALTER TABLE branches ADD COLUMN origin_lat REAL;
ALTER TABLE branches ADD COLUMN origin_lng REAL;
ALTER TABLE branches ADD COLUMN origin_place_id TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN travel_limit_miles REAL;
