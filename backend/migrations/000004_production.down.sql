DROP TABLE IF EXISTS productions;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 3}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
