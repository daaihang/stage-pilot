DROP INDEX IF EXISTS invitation_code_events_invitation_idx;
DROP TABLE IF EXISTS invitation_code_events;
DROP INDEX IF EXISTS workspace_invitations_code_hash_unique;
DROP INDEX IF EXISTS production_invitations_code_hash_unique;
ALTER TABLE workspace_invitations
    DROP COLUMN IF EXISTS code_hash,
    DROP COLUMN IF EXISTS code_ciphertext,
    DROP COLUMN IF EXISTS code_version,
    DROP COLUMN IF EXISTS code_rotated_at;
ALTER TABLE production_invitations
    DROP COLUMN IF EXISTS code_hash,
    DROP COLUMN IF EXISTS code_ciphertext,
    DROP COLUMN IF EXISTS code_version,
    DROP COLUMN IF EXISTS code_rotated_at;
INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 24}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
