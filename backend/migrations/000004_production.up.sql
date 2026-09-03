-- Production：一次具体活动 / 演出 / 项目的内部生产工作空间。
-- Production 属于且只属于一个 Workspace；Workspace 软删除，Production 保持一致。
CREATE TABLE IF NOT EXISTS productions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- 租户边界查询：workspace 内列出 productions。
CREATE INDEX IF NOT EXISTS productions_workspace_id_idx ON productions(workspace_id);
CREATE INDEX IF NOT EXISTS productions_workspace_id_status_idx ON productions(workspace_id, status);

-- 创建者索引仅服务于未来审计查询；created_by 不是权限边界。
CREATE INDEX IF NOT EXISTS productions_created_by_idx ON productions(created_by);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 4}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
