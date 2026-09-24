-- Retry failures without starving newer abandoned uploads.
ALTER TABLE files ADD COLUMN object_cleanup_attempted_at TIMESTAMPTZ;
DROP INDEX files_abandoned_cleanup_idx;
CREATE INDEX files_abandoned_cleanup_idx ON files (object_cleanup_attempted_at, created_at, id)
    WHERE status = 'abandoned' AND object_purged_at IS NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":40}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
