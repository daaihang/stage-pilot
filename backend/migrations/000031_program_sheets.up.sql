CREATE TABLE program_sheets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    revision INTEGER NOT NULL CHECK (revision > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
    change_note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, production_id, revision),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX program_sheets_production_idx ON program_sheets (workspace_id, production_id, status, updated_at DESC);

CREATE TABLE program_sheet_items (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    sheet_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('program','segment','section','interval','note')),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    production_program_id TEXT,
    segment_type_id TEXT,
    title_override TEXT,
    duration_seconds_override INTEGER CHECK (duration_seconds_override IS NULL OR duration_seconds_override >= 0),
    counts_toward_duration BOOLEAN NOT NULL DEFAULT TRUE,
    audience_visible BOOLEAN NOT NULL DEFAULT TRUE,
    requires_execution BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (sheet_id, sort_order),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, sheet_id) REFERENCES program_sheets(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, production_program_id, production_id) REFERENCES production_programs(workspace_id, id, production_id) ON DELETE RESTRICT
    -- segment types are currently a workspace-local desktop taxonomy; keep the
    -- optional identifier without a database FK until that taxonomy is cloud-backed.
);
CREATE INDEX program_sheet_items_sheet_idx ON program_sheet_items (sheet_id, sort_order);

CREATE TABLE program_sheet_assignments (
    sheet_id TEXT NOT NULL REFERENCES program_sheets(id) ON DELETE CASCADE,
    occurrence_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'official' CHECK (role = 'official'),
    assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sheet_id, occurrence_id),
    FOREIGN KEY (occurrence_id) REFERENCES production_occurrences(id) ON DELETE CASCADE
);

CREATE TABLE program_sheet_releases (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    sheet_id TEXT NOT NULL REFERENCES program_sheets(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    published_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (sheet_id, revision),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX program_sheet_releases_sheet_idx ON program_sheet_releases (sheet_id, published_at DESC);

CREATE TABLE program_sheet_share_links (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES program_sheet_releases(id) ON DELETE CASCADE,
    access_scope TEXT NOT NULL CHECK (access_scope IN ('members','link')),
    long_token_hash TEXT NOT NULL UNIQUE,
    short_code_hash TEXT NOT NULL UNIQUE,
    short_expires_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ,
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX program_sheet_share_links_release_idx ON program_sheet_share_links (release_id, revoked_at);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":31}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
