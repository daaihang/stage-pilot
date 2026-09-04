DROP TABLE IF EXISTS production_locations;
ALTER TABLE venue_spaces DROP CONSTRAINT IF EXISTS venue_spaces_workspace_id_venue_id_venue_unique;
INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":11}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
