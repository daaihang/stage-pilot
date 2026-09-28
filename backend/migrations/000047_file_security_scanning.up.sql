ALTER TABLE file_versions
    ADD COLUMN security_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (security_status IN ('pending', 'clean', 'infected', 'unsupported')),
    ADD COLUMN sha256 TEXT NOT NULL DEFAULT '',
    ADD COLUMN scan_engine TEXT NOT NULL DEFAULT '',
    ADD COLUMN scan_signature TEXT NOT NULL DEFAULT '',
    ADD COLUMN scanned_at TIMESTAMPTZ,
    ADD COLUMN security_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN quarantine_until TIMESTAMPTZ,
    ADD COLUMN object_cleanup_attempted_at TIMESTAMPTZ,
    ADD COLUMN object_purged_at TIMESTAMPTZ;
ALTER TABLE file_versions ADD CONSTRAINT file_versions_workspace_file_id_unique UNIQUE (workspace_id, file_id, id);
ALTER TABLE files DROP CONSTRAINT files_current_version_fk;
ALTER TABLE files ADD CONSTRAINT files_current_version_same_file_fk
    FOREIGN KEY (workspace_id, id, current_version_id)
    REFERENCES file_versions(workspace_id, file_id, id) ON DELETE RESTRICT;

CREATE TABLE file_scan_tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'completed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, version_id) REFERENCES file_versions(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, file_id, version_id) REFERENCES file_versions(workspace_id, file_id, id) ON DELETE RESTRICT,
    UNIQUE (version_id)
);
CREATE INDEX file_scan_tasks_claim_idx
    ON file_scan_tasks (available_at, created_at, id)
    WHERE status IN ('pending', 'leased');
CREATE INDEX file_versions_quarantine_idx
    ON file_versions (quarantine_until, object_purged_at, id)
    WHERE security_status = 'infected' AND object_purged_at IS NULL;

-- Backfill every existing immutable v1 as untrusted. The worker waits for the
-- legacy object-freeze step to set frozen_at before claiming its scan task.
INSERT INTO file_scan_tasks(id, workspace_id, file_id, version_id, idempotency_key)
SELECT 'scan-' || md5(v.id), v.workspace_id, v.file_id, v.id, 'version:' || v.id
FROM file_versions v
ON CONFLICT (version_id) DO NOTHING;

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":47}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
