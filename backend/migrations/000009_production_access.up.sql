CREATE TABLE IF NOT EXISTS production_memberships (
    id TEXT PRIMARY KEY,
    production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_key TEXT NOT NULL CHECK (role_key IN ('producer','editor','stage_manager','contributor','viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
    expires_at TIMESTAMPTZ,
    invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS production_memberships_current_unique
    ON production_memberships(production_id, user_id) WHERE status <> 'revoked';
CREATE INDEX IF NOT EXISTS production_memberships_user_access_idx
    ON production_memberships(user_id, production_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS production_invitations (
    id TEXT PRIMARY KEY,
    production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    role_key TEXT NOT NULL CHECK (role_key IN ('producer','editor','stage_manager','contributor','viewer')),
    target_email TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 100),
    accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
    expires_at TIMESTAMPTZ NOT NULL,
    member_expires_at TIMESTAMPTZ,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((target_email IS NULL) OR max_uses = 1)
);
CREATE INDEX IF NOT EXISTS production_invitations_production_idx ON production_invitations(production_id, created_at DESC);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 9}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
