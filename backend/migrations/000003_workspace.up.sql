CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Workspace slug 全局唯一（仅统计未删除的工作空间）。
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_unique
    ON workspaces (LOWER(slug)) WHERE deleted_at IS NULL;

-- User 与 Workspace 是多对多关系；WorkspaceMembership 是独立的领域关系。
-- 所有者是 role = 'owner' 的 membership，不在 workspaces 上冗余 owner 外键。
CREATE TABLE IF NOT EXISTS workspace_memberships (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_memberships_user_id_idx
    ON workspace_memberships(user_id);

CREATE INDEX IF NOT EXISTS workspace_memberships_workspace_id_idx
    ON workspace_memberships(workspace_id);

-- 最近使用的工作空间持久化在服务端；恢复时必须重新校验 membership。
ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS last_workspace_id TEXT
        REFERENCES workspaces(id) ON DELETE SET NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 3}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
