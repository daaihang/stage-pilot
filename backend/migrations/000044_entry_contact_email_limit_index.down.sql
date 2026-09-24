DROP INDEX IF EXISTS entries_campaign_contact_email_limit_idx;

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":43}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
