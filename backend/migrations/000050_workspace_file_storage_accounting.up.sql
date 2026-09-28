-- Workspace storage accounting is separate from object-store billing. Quota
-- counts usable file versions; physical counters are conservative content-byte
-- estimates until the Worker records an object-store reconciliation snapshot.
CREATE TABLE workspace_storage_accounts (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
    quota_limit_bytes BIGINT CHECK (quota_limit_bytes IS NULL OR quota_limit_bytes >= 0),
    quota_used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (quota_used_bytes >= 0),
    quota_reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (quota_reserved_bytes >= 0),
    physical_used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (physical_used_bytes >= 0),
    physical_reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (physical_reserved_bytes >= 0),
    physical_observed_bytes BIGINT CHECK (physical_observed_bytes IS NULL OR physical_observed_bytes >= 0),
    physical_observed_at TIMESTAMPTZ,
    uploads_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    blocked_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_storage_reservations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace_storage_accounts(workspace_id) ON DELETE RESTRICT,
    upload_session_id TEXT UNIQUE,
    idempotency_key TEXT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reservation_kind TEXT NOT NULL CHECK (reservation_kind IN ('upload','copy')),
    status TEXT NOT NULL CHECK (status IN ('reserved','committed','released')),
    quota_reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (quota_reserved_bytes >= 0),
    quota_committed_bytes BIGINT NOT NULL DEFAULT 0 CHECK (quota_committed_bytes >= 0),
    physical_reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (physical_reserved_bytes >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (workspace_id,upload_session_id)
        REFERENCES file_upload_sessions(workspace_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX workspace_storage_reservations_idempotency_idx
    ON workspace_storage_reservations(workspace_id,user_id,idempotency_key)
    WHERE idempotency_key IS NOT NULL;
ALTER TABLE file_copy_attempts ADD COLUMN storage_reservation_id TEXT
    REFERENCES workspace_storage_reservations(id) ON DELETE RESTRICT;

CREATE TABLE workspace_storage_events (
    id BIGSERIAL PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace_storage_accounts(workspace_id) ON DELETE RESTRICT,
    actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
    actor_label TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    quota_used_delta BIGINT NOT NULL DEFAULT 0,
    quota_reserved_delta BIGINT NOT NULL DEFAULT 0,
    physical_used_delta BIGINT NOT NULL DEFAULT 0,
    physical_reserved_delta BIGINT NOT NULL DEFAULT 0,
    reference_type TEXT NOT NULL DEFAULT '',
    reference_id TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX workspace_storage_events_history_idx
    ON workspace_storage_events(workspace_id,created_at DESC,id DESC);
CREATE FUNCTION reject_workspace_storage_event_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'workspace storage events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER workspace_storage_events_append_only
    BEFORE UPDATE OR DELETE ON workspace_storage_events
    FOR EACH ROW EXECUTE FUNCTION reject_workspace_storage_event_mutation();

ALTER TABLE file_versions ADD COLUMN quota_charged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE file_upload_sessions
    ADD COLUMN transport TEXT NOT NULL DEFAULT 'legacy_put'
        CHECK (transport IN ('legacy_put','post','multipart')),
    ADD COLUMN multipart_upload_id TEXT,
    ADD COLUMN idempotency_key TEXT,
    ADD COLUMN cancelled_at TIMESTAMPTZ,
    ADD COLUMN policy_max_bytes BIGINT NOT NULL DEFAULT 2000000000 CHECK (policy_max_bytes > 0),
    ADD COLUMN allowed_content_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN upload_url_expires_at TIMESTAMPTZ;
ALTER TABLE file_versions
    ADD COLUMN policy_max_bytes BIGINT NOT NULL DEFAULT 2000000000 CHECK (policy_max_bytes > 0),
    ADD COLUMN allowed_content_types JSONB NOT NULL DEFAULT '[]'::jsonb;
DROP INDEX IF EXISTS file_versions_quarantine_idx;
CREATE INDEX file_versions_quarantine_idx
    ON file_versions (quarantine_until, object_purged_at, id)
    WHERE security_status IN ('infected','unsupported') AND object_purged_at IS NULL;
ALTER TABLE files ADD COLUMN purge_after TIMESTAMPTZ;
ALTER TABLE file_attachments ADD COLUMN purge_after TIMESTAMPTZ;
-- Give pre-existing trash a full migration grace period; don't immediately
-- purge rows whose original deletion timestamp is already old.
UPDATE files SET purge_after=NOW()+INTERVAL '30 days' WHERE deleted_at IS NOT NULL AND purge_after IS NULL;
UPDATE file_attachments SET purge_after=NOW()+INTERVAL '30 days' WHERE deleted_at IS NOT NULL AND purge_after IS NULL;
UPDATE file_upload_sessions SET upload_url_expires_at=expires_at WHERE transport='legacy_put';
ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_status_check;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_status_check
    CHECK (status IN ('pending','completed','abandoned','cancelled'));
CREATE UNIQUE INDEX file_upload_sessions_idempotency_idx
    ON file_upload_sessions(workspace_id,created_by,idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX file_upload_sessions_pending_scope_idx
    ON file_upload_sessions(workspace_id,created_by,created_at)
    WHERE status='pending';

CREATE TABLE file_upload_session_parts (
    upload_session_id TEXT NOT NULL REFERENCES file_upload_sessions(id) ON DELETE RESTRICT,
    part_number INTEGER NOT NULL CHECK (part_number > 0),
    expected_size BIGINT NOT NULL CHECK (expected_size > 0),
    sha256_base64 TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (upload_session_id,part_number)
);

INSERT INTO workspace_storage_accounts(workspace_id,quota_used_bytes,physical_used_bytes)
SELECT w.id,
       COALESCE(SUM(v.size_bytes) FILTER (
           WHERE f.deleted_at IS NULL
             AND v.security_status IN ('pending','clean')
             AND v.object_purged_at IS NULL
             AND (f.access_mode='library' OR EXISTS (
                 SELECT 1 FROM file_attachments a
                 WHERE a.file_id=f.id AND a.workspace_id=f.workspace_id AND a.deleted_at IS NULL
             ))
       ),0),
       COALESCE(SUM(v.size_bytes) FILTER (WHERE v.object_purged_at IS NULL),0)
FROM workspaces w
LEFT JOIN files f ON f.workspace_id=w.id
LEFT JOIN file_versions v ON v.file_id=f.id AND v.workspace_id=f.workspace_id
GROUP BY w.id
ON CONFLICT (workspace_id) DO NOTHING;

UPDATE file_versions v SET quota_charged=TRUE
FROM files f
WHERE f.id=v.file_id AND f.workspace_id=v.workspace_id
  AND f.deleted_at IS NULL AND v.security_status IN ('pending','clean')
  AND v.object_purged_at IS NULL
  AND (f.access_mode='library' OR EXISTS (
      SELECT 1 FROM file_attachments a
      WHERE a.file_id=f.id AND a.workspace_id=f.workspace_id AND a.deleted_at IS NULL
  ));

INSERT INTO workspace_storage_reservations(
    id,workspace_id,upload_session_id,user_id,reservation_kind,status,
    quota_reserved_bytes,physical_reserved_bytes
)
SELECT s.id,s.workspace_id,s.id,s.created_by,'upload','reserved',s.expected_size,s.expected_size*2
FROM file_upload_sessions s
WHERE s.status='pending'
ON CONFLICT (id) DO NOTHING;

UPDATE workspace_storage_accounts a SET
    quota_reserved_bytes=COALESCE((SELECT SUM(r.quota_reserved_bytes) FROM workspace_storage_reservations r
                                   WHERE r.workspace_id=a.workspace_id AND r.status='reserved'),0),
    physical_reserved_bytes=COALESCE((SELECT SUM(r.physical_reserved_bytes) FROM workspace_storage_reservations r
                                      WHERE r.workspace_id=a.workspace_id),0),
    updated_at=NOW();

INSERT INTO app_metadata(key,value) VALUES('schema','{"version":50}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
