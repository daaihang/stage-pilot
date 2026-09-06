ALTER TABLE user_preferences DROP COLUMN IF EXISTS detail_open_mode;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 19}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
