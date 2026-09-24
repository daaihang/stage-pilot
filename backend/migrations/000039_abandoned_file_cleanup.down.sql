DROP INDEX IF EXISTS files_abandoned_cleanup_idx;
ALTER TABLE files DROP COLUMN IF EXISTS object_purged_at;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":38}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
