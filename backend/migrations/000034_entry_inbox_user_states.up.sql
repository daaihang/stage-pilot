-- Entry Inbox V1: per-user triage state for the Campaign submission read model.
-- This table deliberately does not duplicate Entry facts or create a new Inbox aggregate.

CREATE TABLE entry_inbox_user_states (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ,
    starred_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, entry_id, user_id),
    FOREIGN KEY (workspace_id, entry_id) REFERENCES entries(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX entry_inbox_user_states_user_idx
    ON entry_inbox_user_states (workspace_id, user_id, updated_at DESC, entry_id);
CREATE INDEX entry_inbox_user_states_starred_idx
    ON entry_inbox_user_states (workspace_id, user_id, starred_at DESC, entry_id)
    WHERE starred_at IS NOT NULL;
CREATE INDEX entry_inbox_user_states_unread_idx
    ON entry_inbox_user_states (workspace_id, user_id, entry_id)
    WHERE read_at IS NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":34}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
