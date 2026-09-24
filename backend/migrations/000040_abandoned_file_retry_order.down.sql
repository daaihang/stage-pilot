DROP INDEX IF EXISTS files_abandoned_cleanup_idx;
ALTER TABLE files DROP COLUMN IF EXISTS object_cleanup_attempted_at;
CREATE INDEX files_abandoned_cleanup_idx ON files (created_at, id)
    WHERE status = 'abandoned' AND object_purged_at IS NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":39}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
