CREATE TABLE IF NOT EXISTS workspace_invitations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role_key TEXT NOT NULL CHECK (role_key IN ('admin','member')),
    target_email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses = 1),
    accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (starts_at < expires_at)
);
CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx
    ON workspace_invitations(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_invitation_acceptances (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL REFERENCES workspace_invitations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_id TEXT REFERENCES workspace_memberships(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(invitation_id, user_id)
);

CREATE TABLE IF NOT EXISTS production_invitation_acceptances (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL REFERENCES production_invitations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_id TEXT REFERENCES production_memberships(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(invitation_id, user_id)
);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 23}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
