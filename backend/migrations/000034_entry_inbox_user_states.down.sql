DROP TABLE IF EXISTS entry_inbox_user_states;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":33}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
