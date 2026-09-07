ALTER TABLE workspace_invitations
    ADD COLUMN IF NOT EXISTS code_hash TEXT,
    ADD COLUMN IF NOT EXISTS code_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS code_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS code_rotated_at TIMESTAMPTZ;

ALTER TABLE production_invitations
    ADD COLUMN IF NOT EXISTS code_hash TEXT,
    ADD COLUMN IF NOT EXISTS code_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS code_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS code_rotated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_code_hash_unique
    ON workspace_invitations(code_hash) WHERE code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS production_invitations_code_hash_unique
    ON production_invitations(code_hash) WHERE code_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitation_code_events (
    id TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('workspace','production')),
    invitation_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created','rotated','revealed','revoked')),
    code_version INTEGER NOT NULL CHECK (code_version >= 1),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS invitation_code_events_invitation_idx
    ON invitation_code_events(scope_kind, invitation_id, created_at DESC);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 25}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
