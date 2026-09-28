DROP TABLE file_scan_tasks;
DROP INDEX file_versions_quarantine_idx;
ALTER TABLE files DROP CONSTRAINT files_current_version_same_file_fk;
ALTER TABLE files ADD CONSTRAINT files_current_version_fk
    FOREIGN KEY (workspace_id, current_version_id) REFERENCES file_versions(workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE file_versions
    DROP COLUMN object_purged_at,
    DROP COLUMN quarantine_until,
    DROP COLUMN object_cleanup_attempted_at,
    DROP COLUMN security_reason,
    DROP COLUMN scanned_at,
    DROP COLUMN scan_signature,
    DROP COLUMN scan_engine,
    DROP COLUMN sha256,
    DROP COLUMN security_status;
ALTER TABLE file_versions DROP CONSTRAINT file_versions_workspace_file_id_unique;

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":46}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
