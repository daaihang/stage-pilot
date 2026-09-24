-- Keep soft-deleted uploaded content; track only abandoned upload cleanup.
ALTER TABLE files ADD COLUMN object_purged_at TIMESTAMPTZ;

CREATE INDEX files_abandoned_cleanup_idx ON files (created_at, id)
    WHERE status = 'abandoned' AND object_purged_at IS NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":39}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
