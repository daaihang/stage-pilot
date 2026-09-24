ALTER TABLE users
    DROP COLUMN avatar_revision,
    DROP COLUMN avatar_object_key;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 45}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
