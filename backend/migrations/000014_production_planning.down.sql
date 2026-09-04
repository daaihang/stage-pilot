DROP TABLE IF EXISTS production_settings;
DROP TABLE IF EXISTS workspace_settings;
DROP TABLE IF EXISTS rehearsal_sessions;
DROP TABLE IF EXISTS production_occurrences;
ALTER TABLE production_locations DROP CONSTRAINT IF EXISTS production_locations_workspace_id_id_production_unique;
