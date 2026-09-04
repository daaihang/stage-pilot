ALTER TABLE productions DROP COLUMN IF EXISTS actual_completed_at;
ALTER TABLE productions RENAME COLUMN planned_start_at TO start_at;
ALTER TABLE productions RENAME COLUMN planned_end_at TO end_at;

INSERT INTO app_metadata (key, value) VALUES ('schema','{"version":12}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
