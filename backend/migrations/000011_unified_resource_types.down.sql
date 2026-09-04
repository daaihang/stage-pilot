ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_workspace_venue_type_fk;
ALTER TABLE venues DROP COLUMN IF EXISTS venue_type_id;
DROP TABLE IF EXISTS venue_types;
DROP TABLE IF EXISTS venue_type_templates;
INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":10}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
