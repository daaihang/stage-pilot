DROP TABLE IF EXISTS equipment_items;
DROP TABLE IF EXISTS venue_spaces;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS organization_contacts;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS programs;
DROP TABLE IF EXISTS program_types;
ALTER TABLE productions DROP CONSTRAINT IF EXISTS productions_workspace_id_id_key;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 4}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
