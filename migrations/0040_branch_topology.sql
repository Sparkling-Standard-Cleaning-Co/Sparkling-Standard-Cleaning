-- Branch operating topology and branch-scoped pricing versions.
--
-- One legal entity, two operating branches. Pensacola remains the live
-- production branch. Tampa Bay starts in prelaunch and cannot accept public
-- bookings or published pricing until the owner advances its lifecycle.
--
-- Additive and non-destructive: existing branch rows and pricing history are
-- preserved. The global single-published-pricing index is replaced by one
-- published version per branch.

PRAGMA foreign_keys = ON;

ALTER TABLE branches ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (lifecycle_status IN ('draft','setup','internally_testable','approved_to_launch','live','paused','retired'));
ALTER TABLE branches ADD COLUMN public_slug TEXT;
ALTER TABLE branches ADD COLUMN public_name TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN region_label TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN service_area_json TEXT NOT NULL DEFAULT '{"zips":[],"states":["FL"]}';
ALTER TABLE branches ADD COLUMN hours_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE branches ADD COLUMN services_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE branches ADD COLUMN public_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN public_email TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN gbp_status TEXT NOT NULL DEFAULT 'not_created'
  CHECK (gbp_status IN ('not_created','eligibility_review','prepared','submitted','verified','paused'));
ALTER TABLE branches ADD COLUMN gbp_url TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN launch_note TEXT NOT NULL DEFAULT '';

UPDATE branches SET
  lifecycle_status = CASE WHEN id = 'branch_pensacola' THEN 'live' ELSE 'setup' END,
  public_slug = CASE WHEN id = 'branch_pensacola' THEN 'pensacola' WHEN id = 'branch_tampa' THEN 'tampa-bay' ELSE NULL END,
  public_name = CASE WHEN id = 'branch_pensacola' THEN 'Pensacola' WHEN id = 'branch_tampa' THEN 'Tampa Bay' ELSE name END,
  region_label = CASE WHEN id = 'branch_pensacola' THEN 'Pensacola & surrounding communities' WHEN id = 'branch_tampa' THEN 'Tampa Bay prelaunch' ELSE '' END,
  public_phone = CASE WHEN id = 'branch_pensacola' THEN '(850) 426-8479' ELSE '' END,
  public_email = CASE WHEN id = 'branch_pensacola' THEN 'owner@sparkling-standard.com' ELSE '' END,
  gbp_status = CASE WHEN id = 'branch_pensacola' THEN 'verified' ELSE 'not_created' END,
  launch_note = CASE WHEN id = 'branch_tampa' THEN 'Prelaunch. No public booking, payment, published pricing or second Google Business Profile until the owner verifies staffing, licensing, insurance, tax and capacity.' ELSE '' END
WHERE id IN ('branch_pensacola','branch_tampa');

UPDATE branches SET
  service_area_json = CASE
    WHEN id = 'branch_pensacola' THEN '{"zips":["32501","32502","32503","32504","32505","32506","32507","32508","32511","32514","32526","32530","32533","32561","32563","32565","32566","32570","32571","32577","32583","36426","36502","36507","36526","36527","36530","36532","36535","36542","36551","36561","36567","36580"],"states":["FL","AL"]}'
    ELSE '{"zips":[],"states":["FL"]}'
  END,
  hours_json = CASE
    WHEN id = 'branch_pensacola' THEN '{"label":"Seven days a week, 7:00 a.m. - 7:00 p.m."}'
    ELSE '{"label":"By appointment after launch"}'
  END,
  services_json = CASE
    WHEN id = 'branch_pensacola' THEN '{"residential":"bookable","str":"estimate_enabled","commercial":"estimate_enabled","church":"estimate_enabled"}'
    ELSE '{"residential":"request_only","str":"disabled","commercial":"request_only","church":"request_only"}'
  END
WHERE id IN ('branch_pensacola','branch_tampa');
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_public_slug
  ON branches(public_slug) WHERE public_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS branch_config_versions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  config_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_by_email TEXT,
  published_at TEXT,
  UNIQUE (branch_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_config_one_published
  ON branch_config_versions(branch_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_branch_config_branch_status
  ON branch_config_versions(branch_id, status, version DESC);

-- Rebuild pricing_versions: the original 0026 table made `version` globally
-- unique, which would prevent two branches from holding their own version 1.
-- The replacement keeps the same data and adds branch_id with a per-branch
-- version uniqueness rule.
CREATE TABLE pricing_versions_new (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  config_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  based_on_version INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_by_email TEXT,
  published_at TEXT,
  UNIQUE (branch_id, version)
);

INSERT INTO pricing_versions_new
  (id, branch_id, version, status, config_json, fingerprint, schema_version,
   based_on_version, note, created_by, created_by_email, created_at, updated_at,
   published_by, published_by_email, published_at)
SELECT id, 'branch_pensacola', version, status, config_json, fingerprint, schema_version,
       based_on_version, note, created_by, created_by_email, created_at, updated_at,
       published_by, published_by_email, published_at
FROM pricing_versions;

DROP TABLE pricing_versions;
ALTER TABLE pricing_versions_new RENAME TO pricing_versions;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_one_published_per_branch
  ON pricing_versions(branch_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_pricing_branch_status
  ON pricing_versions(branch_id, status, version DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_status_version
  ON pricing_versions(status, version DESC);

-- A branch is not publicly bookable merely because it exists. These remain
-- server-owned; public forms may request a branch but cannot activate one.
CREATE INDEX IF NOT EXISTS idx_branches_lifecycle
  ON branches(lifecycle_status, status);
