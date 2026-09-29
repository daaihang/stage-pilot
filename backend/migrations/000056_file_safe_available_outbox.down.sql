DROP TRIGGER IF EXISTS file_event_outbox_append_only ON file_event_outbox;
DROP TABLE IF EXISTS file_event_outbox;
DROP FUNCTION IF EXISTS reject_file_event_outbox_mutation();
UPDATE app_metadata SET value='{"version":55}'::jsonb,updated_at=NOW() WHERE key='schema';
