-- Workspace Resource Foundation: reusable tenant-scoped assets.
-- Resource rows carry workspace_id explicitly so future Production associations
-- can use composite foreign keys and cannot cross tenant boundaries.

ALTER TABLE productions
    ADD CONSTRAINT productions_workspace_id_id_key UNIQUE (workspace_id, id);

CREATE TABLE program_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX program_types_workspace_name_unique ON program_types (workspace_id, LOWER(name)) WHERE deleted_at IS NULL;
CREATE INDEX program_types_workspace_idx ON program_types (workspace_id, is_active, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE programs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    program_type_id TEXT,
    default_duration_seconds INTEGER,
    tags TEXT[] NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    technical_notes TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'import', 'template', 'promoted_from_production')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, program_type_id) REFERENCES program_types(workspace_id, id) ON DELETE RESTRICT,
    CHECK (default_duration_seconds IS NULL OR default_duration_seconds >= 0)
);
CREATE INDEX programs_workspace_updated_idx ON programs (workspace_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX programs_workspace_type_status_idx ON programs (workspace_id, program_type_id, status) WHERE deleted_at IS NULL;
CREATE INDEX programs_tags_idx ON programs USING GIN (tags);

CREATE TABLE people (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('artist', 'crew', 'contact')),
    primary_email TEXT NOT NULL DEFAULT '',
    primary_phone TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    skills TEXT[] NOT NULL DEFAULT '{}',
    tags TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id)
);
CREATE INDEX people_workspace_updated_idx ON people (workspace_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX people_workspace_kind_status_idx ON people (workspace_id, kind, status) WHERE deleted_at IS NULL;
CREATE INDEX people_skills_idx ON people USING GIN (skills);
CREATE INDEX people_tags_idx ON people USING GIN (tags);

CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('organizer', 'partner', 'sponsor', 'supplier', 'school', 'ensemble', 'other')),
    city TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id)
);
CREATE INDEX organizations_workspace_updated_idx ON organizations (workspace_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX organizations_workspace_kind_status_idx ON organizations (workspace_id, kind, status) WHERE deleted_at IS NULL;
CREATE INDEX organizations_tags_idx ON organizations USING GIN (tags);

CREATE TABLE organization_contacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, organization_id, person_id),
    FOREIGN KEY (workspace_id, organization_id) REFERENCES organizations(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, person_id) REFERENCES people(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX organization_contacts_organization_idx ON organization_contacts (workspace_id, organization_id) WHERE deleted_at IS NULL;

CREATE TABLE venues (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('theatre', 'hall', 'club', 'outdoor', 'other')),
    city TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    description TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id)
);
CREATE INDEX venues_workspace_updated_idx ON venues (workspace_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX venues_workspace_kind_status_idx ON venues (workspace_id, kind, status) WHERE deleted_at IS NULL;
CREATE INDEX venues_tags_idx ON venues USING GIN (tags);

CREATE TABLE venue_spaces (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    capacity INTEGER,
    technical_notes TEXT NOT NULL DEFAULT '',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, venue_id, name),
    FOREIGN KEY (workspace_id, venue_id) REFERENCES venues(workspace_id, id) ON DELETE CASCADE,
    CHECK (capacity IS NULL OR capacity >= 0)
);
CREATE INDEX venue_spaces_venue_idx ON venue_spaces (workspace_id, venue_id) WHERE deleted_at IS NULL;

CREATE TABLE equipment_items (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('audio', 'lighting', 'video', 'stage', 'power', 'other')),
    quantity_total INTEGER NOT NULL DEFAULT 0 CHECK (quantity_total >= 0),
    unit TEXT NOT NULL DEFAULT '件',
    ownership TEXT NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned', 'rented')),
    storage_location TEXT NOT NULL DEFAULT '',
    technical_notes TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'archived')),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id)
);
CREATE INDEX equipment_items_workspace_updated_idx ON equipment_items (workspace_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX equipment_items_workspace_category_status_idx ON equipment_items (workspace_id, category, status, ownership) WHERE deleted_at IS NULL;
CREATE INDEX equipment_items_tags_idx ON equipment_items USING GIN (tags);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 5}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
