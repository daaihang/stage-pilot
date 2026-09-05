DROP INDEX IF EXISTS production_invitations_active_window_idx;
DROP INDEX IF EXISTS production_memberships_effective_access_idx;

ALTER TABLE production_invitations
    DROP CONSTRAINT IF EXISTS production_invitations_member_window_check,
    DROP CONSTRAINT IF EXISTS production_invitations_time_window_check;

ALTER TABLE production_invitations
    DROP COLUMN IF EXISTS member_starts_at,
    DROP COLUMN IF EXISTS starts_at;

ALTER TABLE production_memberships
    DROP CONSTRAINT IF EXISTS production_memberships_time_window_check,
    DROP COLUMN IF EXISTS starts_at;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 16}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
