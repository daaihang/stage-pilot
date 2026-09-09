DROP INDEX IF EXISTS api_idempotency_keys_expiry_idx;
DROP TABLE IF EXISTS api_idempotency_keys;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 27}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
