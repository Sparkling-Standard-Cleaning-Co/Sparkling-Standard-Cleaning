ALTER TABLE recurring_occurrences ADD COLUMN resource_ids TEXT NOT NULL DEFAULT '';
ALTER TABLE recurring_occurrences ADD COLUMN sync_error TEXT NOT NULL DEFAULT '';
