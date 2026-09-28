-- Legacy v1 rows inherited a current-version pointer before scans existed.
-- Keep history and object references, but unpublish any version that has not
-- passed the new security gate.
UPDATE files f
SET current_version_id = NULL,
    updated_at = NOW()
FROM file_versions v
WHERE f.current_version_id = v.id
  AND v.file_id = f.id
  AND (v.security_status <> 'clean' OR v.object_purged_at IS NOT NULL);

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":48}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
