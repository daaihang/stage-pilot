ALTER TABLE file_scan_tasks
    DROP CONSTRAINT IF EXISTS file_scan_tasks_status_check;
ALTER TABLE file_scan_tasks
    ADD CONSTRAINT file_scan_tasks_status_check
    CHECK (status IN ('pending', 'leased', 'completed', 'needs_attention'));
CREATE INDEX file_scan_tasks_attention_idx ON file_scan_tasks(updated_at DESC, id)
    WHERE status='needs_attention';
ALTER TABLE users
    ADD COLUMN avatar_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (avatar_size_bytes >= 0),
    ADD COLUMN avatar_sha256 TEXT NOT NULL DEFAULT '';

CREATE TABLE file_scan_attempt_events (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES file_scan_tasks(id) ON DELETE RESTRICT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
    event_type TEXT NOT NULL CHECK (event_type IN ('started','retry','completed','needs_attention','operator_retry')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_code TEXT NOT NULL DEFAULT '',
    engine TEXT NOT NULL DEFAULT '',
    signature_version TEXT NOT NULL DEFAULT ''
);
CREATE INDEX file_scan_attempt_events_task_idx ON file_scan_attempt_events(task_id, occurred_at DESC);

CREATE TABLE storage_reconciliation_runs (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('workspace','avatars','all')),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    scanned_objects BIGINT NOT NULL DEFAULT 0 CHECK (scanned_objects >= 0),
    observed_bytes BIGINT NOT NULL DEFAULT 0 CHECK (observed_bytes >= 0),
    orphan_count BIGINT NOT NULL DEFAULT 0 CHECK (orphan_count >= 0),
    missing_count BIGINT NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
    size_mismatch_count BIGINT NOT NULL DEFAULT 0 CHECK (size_mismatch_count >= 0),
    multipart_count BIGINT NOT NULL DEFAULT 0 CHECK (multipart_count >= 0),
    error_code TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX storage_reconciliation_runs_recent_idx ON storage_reconciliation_runs(started_at DESC, id);

CREATE TABLE storage_reconciliation_requests (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
    requested_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    case_reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','completed','failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX storage_reconciliation_requests_claim_idx ON storage_reconciliation_requests(created_at,id)
    WHERE status='pending';

CREATE TABLE storage_reconciliation_findings (
    id BIGSERIAL PRIMARY KEY,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('file_version','upload_staging','copy_attempt','legacy_file','avatar','multipart')),
    finding_type TEXT NOT NULL CHECK (finding_type IN ('orphan','missing','size_mismatch','stale_multipart')),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    expected_size BIGINT,
    observed_size BIGINT,
    first_seen_run_id TEXT NOT NULL REFERENCES storage_reconciliation_runs(id) ON DELETE RESTRICT,
    last_seen_run_id TEXT NOT NULL REFERENCES storage_reconciliation_runs(id) ON DELETE RESTRICT,
    consecutive_runs INTEGER NOT NULL DEFAULT 1 CHECK (consecutive_runs > 0),
    confirmed_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX storage_reconciliation_findings_open_idx
    ON storage_reconciliation_findings(asset_type,finding_type,bucket,object_key)
    WHERE resolved_at IS NULL;
CREATE INDEX storage_reconciliation_findings_open_recent_idx
    ON storage_reconciliation_findings(workspace_id,updated_at DESC,id) WHERE resolved_at IS NULL;

CREATE TABLE file_security_audit_events (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL CHECK (action IN ('download_granted','download_denied','delete','detach','restore')),
    result TEXT NOT NULL CHECK (result IN ('allowed','denied','completed','failed')),
    workspace_id TEXT NOT NULL DEFAULT '',
    production_id TEXT NOT NULL DEFAULT '',
    parent_type TEXT NOT NULL DEFAULT '',
    parent_id TEXT NOT NULL DEFAULT '',
    attachment_id TEXT NOT NULL DEFAULT '',
    file_id TEXT NOT NULL DEFAULT '',
    version_id TEXT NOT NULL DEFAULT '',
    security_class TEXT NOT NULL DEFAULT '',
    permission_basis TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX file_security_audit_lookup_idx
    ON file_security_audit_events(attachment_id,occurred_at DESC,id);
CREATE INDEX file_security_audit_actor_idx
    ON file_security_audit_events(actor_user_id,occurred_at DESC,id);

CREATE TABLE file_object_access_events (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL,
    storage_request_id TEXT NOT NULL DEFAULT '',
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('GetObject','DeleteObject')),
    status_code INTEGER NOT NULL,
    outcome TEXT NOT NULL DEFAULT '',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX file_object_access_lookup_idx
    ON file_object_access_events(bucket,object_key,occurred_at DESC,id);
CREATE INDEX file_object_access_request_idx
    ON file_object_access_events(storage_request_id) WHERE storage_request_id<>'';
CREATE UNIQUE INDEX file_object_access_idempotency_idx
    ON file_object_access_events(storage_request_id,operation) WHERE storage_request_id<>'';

CREATE TABLE file_ops_audit_events (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    case_reference TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX file_ops_audit_target_idx ON file_ops_audit_events(target_type,target_id,occurred_at DESC);

CREATE TABLE file_replication_tasks (
    id BIGSERIAL PRIMARY KEY,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('file_version','avatar')),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
    asset_id TEXT NOT NULL,
    source_bucket TEXT NOT NULL,
    source_key TEXT NOT NULL,
    target_bucket TEXT NOT NULL,
    target_key TEXT NOT NULL,
    expected_size BIGINT NOT NULL CHECK (expected_size >= 0),
    expected_sha256 TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','replicated','purge_pending','purged','needs_attention')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    replicated_at TIMESTAMPTZ,
    source_purged_at TIMESTAMPTZ,
    replica_purge_after TIMESTAMPTZ,
    replica_purged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(asset_type,asset_id),
    UNIQUE(target_bucket,target_key)
);
CREATE INDEX file_replication_tasks_claim_idx
    ON file_replication_tasks(available_at,created_at,id)
    WHERE status IN ('pending','leased','purge_pending');

CREATE TABLE file_replication_watermarks (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
    contiguous_through TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO file_replication_watermarks(id) VALUES(1) ON CONFLICT DO NOTHING;

CREATE TABLE file_backup_status (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
    last_base_backup_at TIMESTAMPTZ,
    wal_archived_through TIMESTAMPTZ,
    last_restore_validation_at TIMESTAMPTZ,
    last_restore_validation_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (last_restore_validation_status IN ('unknown','passed','failed')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO file_backup_status(id) VALUES(1) ON CONFLICT DO NOTHING;

CREATE FUNCTION reject_file_ops_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'file operations audit records are append-only';
END;
$$;
CREATE TRIGGER file_security_audit_append_only
    BEFORE UPDATE OR DELETE ON file_security_audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_file_ops_audit_mutation();
CREATE TRIGGER file_object_access_append_only
    BEFORE UPDATE OR DELETE ON file_object_access_events
    FOR EACH ROW EXECUTE FUNCTION reject_file_ops_audit_mutation();
CREATE TRIGGER file_ops_audit_append_only
    BEFORE UPDATE OR DELETE ON file_ops_audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_file_ops_audit_mutation();

INSERT INTO app_metadata(key,value) VALUES('schema','{"version":55}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
