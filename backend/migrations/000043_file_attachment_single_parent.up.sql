-- A logical attachment file has exactly one authorization parent. Cross-activity
-- reuse creates an independent file and version rather than a second link.
ALTER TABLE file_attachments ADD CONSTRAINT file_attachments_file_id_unique UNIQUE (file_id);
INSERT INTO app_metadata(key,value) VALUES('schema','{"version":43}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
