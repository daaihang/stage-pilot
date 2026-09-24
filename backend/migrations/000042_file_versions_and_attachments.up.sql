ALTER TABLE files ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'library'
    CHECK (access_mode IN ('library', 'attachment'));
ALTER TABLE files ADD COLUMN current_version_id TEXT;

CREATE TABLE file_versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    etag TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_file_id TEXT,
    source_version_id TEXT,
    frozen_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (file_id, version_no),
    UNIQUE (bucket, object_key),
    FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, source_file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, source_version_id) REFERENCES file_versions(workspace_id, id) ON DELETE RESTRICT
);
ALTER TABLE files ADD CONSTRAINT files_current_version_fk
    FOREIGN KEY (workspace_id, current_version_id) REFERENCES file_versions(workspace_id, id) ON DELETE RESTRICT;

INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,created_at)
SELECT 'fv_' || md5(id || ':v1'),workspace_id,id,1,bucket,object_key,filename,content_type,size_bytes,etag,created_by,created_at
FROM files WHERE status='uploaded'
ON CONFLICT (file_id,version_no) DO NOTHING;
UPDATE files f SET current_version_id=v.id
FROM file_versions v WHERE v.file_id=f.id AND v.version_no=1 AND f.status='uploaded' AND f.current_version_id IS NULL;

CREATE TABLE file_upload_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    staging_bucket TEXT NOT NULL,
    staging_key TEXT NOT NULL,
    expected_size BIGINT NOT NULL CHECK (expected_size > 0),
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','abandoned')),
    resulting_version_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    object_cleanup_attempted_at TIMESTAMPTZ,
    object_purged_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, resulting_version_id) REFERENCES file_versions(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX file_upload_sessions_cleanup_idx ON file_upload_sessions (object_cleanup_attempted_at,created_at,id)
    WHERE status='abandoned' AND object_purged_at IS NULL;

CREATE TABLE file_copy_attempts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','committed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    object_cleanup_attempted_at TIMESTAMPTZ,
    object_purged_at TIMESTAMPTZ
);
CREATE INDEX file_copy_attempts_cleanup_idx ON file_copy_attempts(object_cleanup_attempted_at,created_at,id)
    WHERE status='pending' AND object_purged_at IS NULL;

CREATE TABLE file_attachments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    file_type_id TEXT,
    security_class TEXT NOT NULL DEFAULT 'standard' CHECK (security_class IN ('standard','restricted')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id,id),
    FOREIGN KEY (workspace_id,file_id) REFERENCES files(workspace_id,id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id,file_type_id) REFERENCES file_types(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE program_file_attachments (
    attachment_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    program_id TEXT NOT NULL,
    FOREIGN KEY (workspace_id,attachment_id) REFERENCES file_attachments(workspace_id,id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id,program_id) REFERENCES programs(workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX program_file_attachments_parent_idx ON program_file_attachments(workspace_id,program_id);
CREATE TABLE production_program_file_attachments (
    attachment_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    production_id TEXT NOT NULL,
    production_program_id TEXT NOT NULL,
    FOREIGN KEY (workspace_id,attachment_id) REFERENCES file_attachments(workspace_id,id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id,production_program_id,production_id) REFERENCES production_programs(workspace_id,id,production_id) ON DELETE RESTRICT
);
CREATE INDEX production_program_file_attachments_parent_idx ON production_program_file_attachments(workspace_id,production_id,production_program_id);

INSERT INTO app_metadata(key,value) VALUES('schema','{"version":42}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
