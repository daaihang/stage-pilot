CREATE TABLE files (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT,
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    etag TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'abandoned')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX files_workspace_scope_idx ON files (workspace_id, production_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX files_cleanup_idx ON files (status, created_at) WHERE deleted_at IS NULL;
INSERT INTO app_metadata (key, value) VALUES ('schema', '{"version": 6}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
