-- Membership lifecycle and append-only authorization history.

ALTER TABLE workspace_memberships
    DROP CONSTRAINT IF EXISTS workspace_memberships_status_check;

ALTER TABLE workspace_memberships
    ADD CONSTRAINT workspace_memberships_status_check
    CHECK (status IN ('active', 'invited', 'suspended', 'revoked'));

ALTER TABLE workspace_memberships
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS workspace_memberships_active_idx
    ON workspace_memberships(workspace_id, user_id)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS membership_audit_events (
    id TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('workspace', 'production')),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    production_id TEXT REFERENCES productions(id) ON DELETE RESTRICT,
    membership_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    previous_role TEXT,
    next_role TEXT,
    previous_status TEXT,
    next_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (scope_kind = 'workspace' AND production_id IS NULL)
        OR (scope_kind = 'production' AND production_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS membership_audit_events_workspace_idx
    ON membership_audit_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS membership_audit_events_membership_idx
    ON membership_audit_events(scope_kind, membership_id, created_at DESC);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":38}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
