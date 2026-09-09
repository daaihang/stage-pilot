DROP TABLE IF EXISTS campaign_public_submission_idempotency;
DROP TABLE IF EXISTS campaign_share_links;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":32}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
