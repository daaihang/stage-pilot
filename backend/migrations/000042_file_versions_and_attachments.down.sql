DROP TABLE production_program_file_attachments;
DROP TABLE program_file_attachments;
DROP TABLE file_attachments;
DROP TABLE file_upload_sessions;
DROP TABLE file_copy_attempts;
ALTER TABLE files DROP CONSTRAINT files_current_version_fk;
ALTER TABLE files DROP COLUMN current_version_id;
ALTER TABLE files DROP COLUMN access_mode;
DROP TABLE file_versions;
INSERT INTO app_metadata(key,value) VALUES('schema','{"version":41}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
