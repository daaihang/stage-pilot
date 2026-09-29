CREATE TABLE file_event_outbox (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (event_type = 'file.version.safe_available'),
    schema_version SMALLINT NOT NULL CHECK (schema_version > 0),
    aggregate_type TEXT NOT NULL CHECK (aggregate_type = 'file_version'),
    aggregate_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    file_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_type, version_id),
    FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, file_id, version_id) REFERENCES file_versions(workspace_id, file_id, id) ON DELETE RESTRICT,
    CHECK (aggregate_id = version_id)
);
CREATE INDEX file_event_outbox_type_time_idx ON file_event_outbox(event_type, occurred_at, event_id);

CREATE FUNCTION reject_file_event_outbox_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'file event outbox records are append-only';
END;
$$;
CREATE TRIGGER file_event_outbox_append_only
    BEFORE UPDATE OR DELETE ON file_event_outbox
    FOR EACH ROW EXECUTE FUNCTION reject_file_event_outbox_mutation();

INSERT INTO file_event_outbox(
    event_id,event_type,schema_version,aggregate_type,aggregate_id,
    workspace_id,file_id,version_id,occurred_at,payload
)
SELECT
    'file.version.safe_available:' || v.id,
    'file.version.safe_available',
    1,
    'file_version',
    v.id,
    v.workspace_id,
    v.file_id,
    v.id,
    COALESCE(v.scanned_at,v.created_at),
    jsonb_build_object(
        'event_id','file.version.safe_available:' || v.id,
        'event_type','file.version.safe_available',
        'schema_version',1,
        'workspace_id',v.workspace_id,
        'file_id',v.file_id,
        'version_id',v.id,
        'occurred_at',COALESCE(v.scanned_at,v.created_at),
        'size_bytes',v.size_bytes,
        'sha256',NULLIF(v.sha256,''),
        'content_type',v.content_type
    )
FROM file_versions v
WHERE v.security_status='clean' AND v.object_purged_at IS NULL
ON CONFLICT (event_type,version_id) DO NOTHING;

INSERT INTO app_metadata(key,value) VALUES('schema','{"version":56}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
