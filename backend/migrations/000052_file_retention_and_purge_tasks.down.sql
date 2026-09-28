DROP TABLE IF EXISTS file_purge_tasks;
DROP TABLE IF EXISTS file_retention_holds;
DELETE FROM app_metadata WHERE key='schema' AND value->>'version'='52';
INSERT INTO app_metadata(key,value)
VALUES ('schema', '{"version":51}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
