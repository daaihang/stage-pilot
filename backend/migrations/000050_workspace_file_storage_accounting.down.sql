DELETE FROM app_metadata WHERE key='schema' AND value->>'version'='50';
DROP TABLE IF EXISTS file_upload_session_parts;
DROP INDEX IF EXISTS file_upload_sessions_pending_scope_idx;
DROP INDEX IF EXISTS file_upload_sessions_idempotency_idx;
ALTER TABLE file_upload_sessions DROP CONSTRAINT IF EXISTS file_upload_sessions_status_check;
UPDATE file_upload_sessions SET status='abandoned' WHERE status='cancelled';
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_status_check
    CHECK (status IN ('pending','completed','abandoned'));
ALTER TABLE file_upload_sessions
    DROP COLUMN IF EXISTS upload_url_expires_at,
    DROP COLUMN IF EXISTS allowed_content_types,
    DROP COLUMN IF EXISTS policy_max_bytes,
    DROP COLUMN IF EXISTS cancelled_at,
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS multipart_upload_id,
    DROP COLUMN IF EXISTS transport;
ALTER TABLE file_versions DROP COLUMN IF EXISTS quota_charged;
ALTER TABLE file_versions DROP COLUMN IF EXISTS allowed_content_types;
ALTER TABLE file_versions DROP COLUMN IF EXISTS policy_max_bytes;
DROP INDEX IF EXISTS file_versions_quarantine_idx;
CREATE INDEX file_versions_quarantine_idx
    ON file_versions (quarantine_until, object_purged_at, id)
    WHERE security_status='infected' AND object_purged_at IS NULL;
ALTER TABLE files DROP COLUMN IF EXISTS purge_after;
ALTER TABLE file_attachments DROP COLUMN IF EXISTS purge_after;
DROP TABLE IF EXISTS workspace_storage_events;
DROP FUNCTION IF EXISTS reject_workspace_storage_event_mutation();
ALTER TABLE file_copy_attempts DROP COLUMN IF EXISTS storage_reservation_id;
DROP INDEX IF EXISTS workspace_storage_reservations_idempotency_idx;
DROP TABLE IF EXISTS workspace_storage_reservations;
DROP TABLE IF EXISTS workspace_storage_accounts;
INSERT INTO app_metadata(key,value) VALUES('schema','{"version":49}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
