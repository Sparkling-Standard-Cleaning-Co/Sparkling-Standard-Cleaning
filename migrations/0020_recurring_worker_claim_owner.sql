-- Explicit owner token for durable recurring Worker run claims.
ALTER TABLE recurring_worker_runs ADD COLUMN owner_token TEXT NOT NULL DEFAULT '';
