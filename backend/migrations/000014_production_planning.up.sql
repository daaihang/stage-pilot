ALTER TABLE production_locations ADD CONSTRAINT production_locations_workspace_id_id_production_unique UNIQUE (workspace_id, id, production_id);

CREATE TABLE production_occurrences (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'performance' CHECK (kind IN ('preview','performance','encore','other')),
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    scheduled_start_at TIMESTAMPTZ,
    scheduled_end_at TIMESTAMPTZ,
    actual_start_at TIMESTAMPTZ,
    actual_end_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','live','completed','canceled')),
    production_location_id TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, production_location_id, production_id) REFERENCES production_locations(workspace_id, id, production_id) ON DELETE RESTRICT,
    CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at >= scheduled_start_at)
);
CREATE INDEX production_occurrences_production_idx ON production_occurrences(workspace_id, production_id, scheduled_start_at, id);

CREATE TABLE rehearsal_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    occurrence_id TEXT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'rehearsal' CHECK (kind IN ('rehearsal','technical','dress','cue_to_cue','other')),
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    scheduled_start_at TIMESTAMPTZ,
    scheduled_end_at TIMESTAMPTZ,
    actual_start_at TIMESTAMPTZ,
    actual_end_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','live','completed','canceled')),
    production_location_id TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, occurrence_id, production_id) REFERENCES production_occurrences(workspace_id, id, production_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, production_location_id, production_id) REFERENCES production_locations(workspace_id, id, production_id) ON DELETE RESTRICT,
    CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at >= scheduled_start_at)
);
CREATE INDEX rehearsal_sessions_production_idx ON rehearsal_sessions(workspace_id, production_id, scheduled_start_at, id);

CREATE TABLE workspace_settings (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    require_actual_start_before_completion BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO workspace_settings (workspace_id)
SELECT id FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

CREATE TABLE production_settings (
    production_id TEXT PRIMARY KEY REFERENCES productions(id) ON DELETE CASCADE,
    require_actual_start_before_completion BOOLEAN,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO production_occurrences (id, workspace_id, production_id, name, kind, timezone, status, created_by)
SELECT 'occ-' || p.id, p.workspace_id, p.id, '默认场次', 'performance', p.timezone, 'planned', p.created_by
FROM productions p
WHERE p.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":14}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
