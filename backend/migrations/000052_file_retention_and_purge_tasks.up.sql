CREATE TABLE file_retention_holds (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    actor_label TEXT NOT NULL,
    reason TEXT NOT NULL,
    case_reference TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    released_by TEXT NOT NULL DEFAULT '',
    release_reason TEXT NOT NULL DEFAULT '',
    release_case_reference TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX file_retention_holds_active_file_idx
    ON file_retention_holds(workspace_id, file_id) WHERE released_at IS NULL;

CREATE TABLE file_purge_tasks (
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    version_id TEXT PRIMARY KEY,
    cause TEXT NOT NULL CHECK (cause IN ('retention_expired','operator_requested')),
    actor_label TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    case_reference TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','completed','cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, file_id, version_id) REFERENCES file_versions(workspace_id, file_id, id) ON DELETE RESTRICT
);
CREATE INDEX file_purge_tasks_ready_idx
    ON file_purge_tasks(available_at,created_at,version_id) WHERE status='pending';
CREATE INDEX file_purge_tasks_expired_lease_idx
    ON file_purge_tasks(lease_until,created_at,version_id) WHERE status='leased';
CREATE INDEX file_purge_tasks_file_idx
    ON file_purge_tasks(workspace_id,file_id,status,version_id);

INSERT INTO app_metadata(key,value)
VALUES ('schema', '{"version":52}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
