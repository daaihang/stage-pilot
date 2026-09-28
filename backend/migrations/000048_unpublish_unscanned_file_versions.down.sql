-- Restore only versions that passed scanning. Unscanned or rejected content
-- must remain unpublished even when rolling back this pointer cleanup.
UPDATE files f
SET current_version_id = (
    SELECT v.id
    FROM file_versions v
    WHERE v.file_id = f.id
      AND v.security_status = 'clean'
      AND v.object_purged_at IS NULL
    ORDER BY v.version_no DESC
    LIMIT 1
),
    updated_at = NOW()
WHERE f.current_version_id IS NULL
  AND EXISTS (
      SELECT 1 FROM file_versions v
      WHERE v.file_id = f.id
        AND v.security_status = 'clean'
        AND v.object_purged_at IS NULL
  );

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":47}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
