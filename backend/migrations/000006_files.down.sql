DROP TABLE IF EXISTS files;
INSERT INTO app_metadata (key, value) VALUES ('schema', '{"version": 5}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
