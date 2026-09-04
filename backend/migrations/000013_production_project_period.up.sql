ALTER TABLE productions RENAME COLUMN start_at TO planned_start_at;
ALTER TABLE productions RENAME COLUMN end_at TO planned_end_at;
ALTER TABLE productions ADD COLUMN actual_completed_at TIMESTAMPTZ;

INSERT INTO app_metadata (key, value) VALUES ('schema','{"version":13}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
