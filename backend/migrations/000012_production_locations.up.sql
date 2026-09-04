ALTER TABLE venue_spaces ADD CONSTRAINT venue_spaces_workspace_id_venue_id_venue_unique UNIQUE (workspace_id, id, venue_id);

CREATE TABLE production_locations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    venue_space_id TEXT,
    purpose TEXT NOT NULL DEFAULT 'primary' CHECK (purpose IN ('primary','performance','rehearsal','office','other')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, venue_id) REFERENCES venues(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, venue_space_id, venue_id) REFERENCES venue_spaces(workspace_id, id, venue_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_locations_one_primary ON production_locations(production_id) WHERE is_primary;
CREATE UNIQUE INDEX production_locations_unique_assignment ON production_locations(production_id, venue_id, COALESCE(venue_space_id, ''));
CREATE INDEX production_locations_production_order_idx ON production_locations(workspace_id, production_id, sort_order, id);

INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":12}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
