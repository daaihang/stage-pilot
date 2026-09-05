ALTER TABLE production_memberships
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

ALTER TABLE production_memberships
    ADD CONSTRAINT production_memberships_time_window_check
    CHECK (starts_at IS NULL OR expires_at IS NULL OR starts_at < expires_at);

ALTER TABLE production_invitations
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

ALTER TABLE production_invitations
    ADD COLUMN IF NOT EXISTS member_starts_at TIMESTAMPTZ;

UPDATE production_invitations
SET starts_at = created_at
WHERE starts_at IS NULL;

ALTER TABLE production_invitations
    ALTER COLUMN starts_at SET DEFAULT NOW(),
    ALTER COLUMN starts_at SET NOT NULL;

ALTER TABLE production_invitations
    ADD CONSTRAINT production_invitations_time_window_check
    CHECK (starts_at < expires_at);

ALTER TABLE production_invitations
    ADD CONSTRAINT production_invitations_member_window_check
    CHECK (member_starts_at IS NULL OR member_expires_at IS NULL OR member_starts_at < member_expires_at);

CREATE INDEX IF NOT EXISTS production_memberships_effective_access_idx
    ON production_memberships(production_id, user_id, status, starts_at, expires_at);

CREATE INDEX IF NOT EXISTS production_invitations_active_window_idx
    ON production_invitations(production_id, starts_at, expires_at)
    WHERE revoked_at IS NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 17}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
