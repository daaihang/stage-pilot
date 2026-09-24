ALTER TABLE users
    ADD COLUMN avatar_object_key TEXT NOT NULL DEFAULT '',
    ADD COLUMN avatar_revision TEXT NOT NULL DEFAULT '';

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 46}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
