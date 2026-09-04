ALTER TABLE workspace_settings
    ADD COLUMN schedule_conflict_policy TEXT NOT NULL DEFAULT 'block'
        CHECK (schedule_conflict_policy IN ('block','warn'));
ALTER TABLE production_settings
    ADD COLUMN schedule_conflict_policy TEXT
        CHECK (schedule_conflict_policy IS NULL OR schedule_conflict_policy IN ('block','warn'));
ALTER TABLE rehearsal_sessions
    ADD CONSTRAINT rehearsal_sessions_workspace_id_id_production_unique UNIQUE (workspace_id, id, production_id);

CREATE TABLE schedule_items (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    context_type TEXT NOT NULL CHECK (context_type IN ('production','occurrence','rehearsal')),
    occurrence_id TEXT,
    rehearsal_session_id TEXT,
    title TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT 'other' CHECK (item_type IN ('load_in','crew_call','technical_check','rehearsal','doors','performance','break','strike','travel','other')),
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    scheduled_start_at TIMESTAMPTZ,
    scheduled_end_at TIMESTAMPTZ,
    actual_start_at TIMESTAMPTZ,
    actual_end_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','live','completed','canceled')),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, occurrence_id, production_id) REFERENCES production_occurrences(workspace_id, id, production_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, rehearsal_session_id, production_id) REFERENCES rehearsal_sessions(workspace_id, id, production_id) ON DELETE RESTRICT,
    CHECK ((context_type='production' AND occurrence_id IS NULL AND rehearsal_session_id IS NULL)
        OR (context_type='occurrence' AND occurrence_id IS NOT NULL AND rehearsal_session_id IS NULL)
        OR (context_type='rehearsal' AND occurrence_id IS NULL AND rehearsal_session_id IS NOT NULL)),
    CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at >= scheduled_start_at)
);
CREATE INDEX schedule_items_production_time_idx ON schedule_items(workspace_id, production_id, scheduled_start_at, id);
CREATE INDEX schedule_items_context_idx ON schedule_items(workspace_id, production_id, context_type, occurrence_id, rehearsal_session_id);

CREATE TABLE schedule_item_locations (
    schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    production_id TEXT NOT NULL,
    production_location_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    role TEXT NOT NULL DEFAULT 'primary',
    PRIMARY KEY (schedule_item_id, production_location_id),
    FOREIGN KEY (workspace_id, schedule_item_id) REFERENCES schedule_items(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, production_location_id, production_id) REFERENCES production_locations(workspace_id, id, production_id) ON DELETE RESTRICT
);
CREATE INDEX schedule_item_locations_resource_idx ON schedule_item_locations(workspace_id, production_id, production_location_id, schedule_item_id);

INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":15}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
