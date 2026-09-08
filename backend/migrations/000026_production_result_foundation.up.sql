-- Production result foundation: activity-scoped snapshots and commitments.
-- Campaign/Entry provenance columns are intentionally nullable here; migration
-- 000027 adds the Entry foreign keys after the intake tables exist.

CREATE TABLE production_programs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    workspace_program_id TEXT,
    source_entry_id TEXT,
    source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual', 'workspace_copy', 'submission')),
    name TEXT NOT NULL,
    program_type_id TEXT,
    program_type_name TEXT NOT NULL DEFAULT '',
    performers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(performers) = 'array'),
    duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    description TEXT NOT NULL DEFAULT '',
    technical_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'needs_info', 'confirmed', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, workspace_program_id) REFERENCES programs(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, program_type_id) REFERENCES program_types(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX production_programs_production_idx
    ON production_programs (workspace_id, production_id, status, updated_at DESC, id);

CREATE TABLE production_people (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    workspace_person_id TEXT,
    source_entry_id TEXT,
    display_name TEXT NOT NULL,
    primary_email TEXT NOT NULL DEFAULT '',
    primary_phone TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    roles TEXT[] NOT NULL DEFAULT '{}',
    department TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'confirmed', 'withdrawn', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, workspace_person_id) REFERENCES people(workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX production_people_linked_person_unique
    ON production_people (workspace_id, production_id, workspace_person_id)
    WHERE workspace_person_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX production_people_production_idx
    ON production_people (workspace_id, production_id, status, updated_at DESC, id);

CREATE TABLE production_registrations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    entry_id TEXT,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('person', 'team', 'organization')),
    subject_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(subject_snapshot) = 'object'),
    participant_count INTEGER NOT NULL DEFAULT 1 CHECK (participant_count >= 1),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlisted', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX production_registrations_production_idx
    ON production_registrations (workspace_id, production_id, status, created_at DESC, id);

CREATE TABLE requirements (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    source_entry_id TEXT,
    kind TEXT NOT NULL CHECK (btrim(kind) <> ''),
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    description TEXT NOT NULL DEFAULT '',
    quantity_requested NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity_requested >= 0),
    unit TEXT NOT NULL DEFAULT '件',
    due_at TIMESTAMPTZ,
    candidate_person_id TEXT,
    candidate_organization_id TEXT,
    candidate_venue_id TEXT,
    candidate_venue_space_id TEXT,
    candidate_equipment_item_id TEXT,
    candidate_file_id TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, candidate_person_id) REFERENCES people(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, candidate_organization_id) REFERENCES organizations(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, candidate_venue_id) REFERENCES venues(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, candidate_venue_space_id, candidate_venue_id) REFERENCES venue_spaces(workspace_id, id, venue_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, candidate_equipment_item_id) REFERENCES equipment_items(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, candidate_file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX requirements_production_status_idx
    ON requirements (workspace_id, production_id, status, due_at, id);

CREATE TABLE resource_commitments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    requirement_id TEXT,
    source_entry_id TEXT,
    commitment_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(commitment_snapshot) = 'object'),
    committed_person_id TEXT,
    committed_organization_id TEXT,
    committed_venue_id TEXT,
    committed_venue_space_id TEXT,
    committed_equipment_item_id TEXT,
    committed_file_id TEXT,
    quantity_committed NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity_committed >= 0),
    unit TEXT NOT NULL DEFAULT '件',
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'declined', 'withdrawn')),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, requirement_id, production_id) REFERENCES requirements(workspace_id, id, production_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, committed_person_id) REFERENCES people(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, committed_organization_id) REFERENCES organizations(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, committed_venue_id) REFERENCES venues(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, committed_venue_space_id, committed_venue_id) REFERENCES venue_spaces(workspace_id, id, venue_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, committed_equipment_item_id) REFERENCES equipment_items(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, committed_file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX resource_commitments_production_status_idx
    ON resource_commitments (workspace_id, production_id, status, created_at DESC, id);
CREATE INDEX resource_commitments_requirement_idx
    ON resource_commitments (workspace_id, requirement_id, status)
    WHERE requirement_id IS NOT NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 26}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
