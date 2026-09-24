ALTER TABLE file_attachments DROP CONSTRAINT file_attachments_file_id_unique;
INSERT INTO app_metadata(key,value) VALUES('schema','{"version":42}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
