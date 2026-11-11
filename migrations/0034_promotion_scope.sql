-- Promotion scope separates cleaning offers from gift-certificate offers.
PRAGMA foreign_keys = ON;
ALTER TABLE promotions ADD COLUMN scope TEXT NOT NULL DEFAULT 'cleaning'
  CHECK (scope IN ('cleaning','gift','both'));
UPDATE promotions SET scope = 'cleaning' WHERE scope IS NULL OR scope = '';
