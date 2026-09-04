DROP TABLE IF EXISTS production_invitations;
DROP TABLE IF EXISTS production_memberships;
INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 8}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
