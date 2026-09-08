-- Campaign Intake V1: templates, immutable form revisions, staged entries,
-- decisions, idempotent materialization and collection responses.

CREATE TABLE campaign_templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('system', 'workspace')),
    kind TEXT NOT NULL CHECK (kind IN ('REGISTRATION', 'SUBMISSION', 'RECRUITMENT', 'COLLECTION')),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    latest_version INTEGER NOT NULL DEFAULT 1 CHECK (latest_version >= 1),
    source_template_id TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (source_template_id) REFERENCES campaign_templates(id) ON DELETE SET NULL,
    CHECK ((scope = 'system' AND workspace_id IS NULL AND created_by IS NULL)
        OR (scope = 'workspace' AND workspace_id IS NOT NULL AND created_by IS NOT NULL))
);
CREATE INDEX campaign_templates_scope_kind_idx
    ON campaign_templates (scope, workspace_id, kind, status, updated_at DESC, id)
    WHERE archived_at IS NULL;

CREATE TABLE campaign_template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES campaign_templates(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    definition JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(definition) = 'object'),
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (template_id, version),
    UNIQUE (workspace_id, id)
);
CREATE INDEX campaign_template_versions_template_idx
    ON campaign_template_versions (template_id, version DESC);

CREATE TABLE form_versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
    blocks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocks) = 'array'),
    fields JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
    logic_rules JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(logic_rules) = 'array'),
    end_screen JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(end_screen) = 'object'),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id)
);

CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('REGISTRATION', 'SUBMISSION', 'RECRUITMENT', 'COLLECTION')),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'closed', 'archived')),
    public_slug TEXT,
    published_revision_id TEXT,
    source_template_id TEXT,
    source_template_version INTEGER CHECK (source_template_version IS NULL OR source_template_version >= 1),
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (source_template_id) REFERENCES campaign_templates(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX campaigns_public_slug_unique
    ON campaigns (public_slug)
    WHERE public_slug IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX campaigns_production_status_idx
    ON campaigns (workspace_id, production_id, status, updated_at DESC, id)
    WHERE deleted_at IS NULL;

CREATE TABLE campaign_revisions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
    form_version_id TEXT NOT NULL,
    availability_policy JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(availability_policy) = 'object'),
    review_workflow JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(review_workflow) = 'object'),
    materialization_plan JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(materialization_plan) = 'object'),
    change_note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, campaign_id),
    UNIQUE (workspace_id, campaign_id, revision_no),
    FOREIGN KEY (workspace_id, campaign_id) REFERENCES campaigns(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, form_version_id) REFERENCES form_versions(workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX campaign_revisions_one_draft_unique
    ON campaign_revisions (workspace_id, campaign_id)
    WHERE status = 'draft';
CREATE UNIQUE INDEX campaign_revisions_one_published_unique
    ON campaign_revisions (workspace_id, campaign_id)
    WHERE status = 'published';
CREATE INDEX campaign_revisions_campaign_idx
    ON campaign_revisions (workspace_id, campaign_id, revision_no DESC);

ALTER TABLE campaigns
    ADD CONSTRAINT campaigns_published_revision_fk
    FOREIGN KEY (workspace_id, published_revision_id, id)
    REFERENCES campaign_revisions(workspace_id, id, campaign_id)
    ON DELETE RESTRICT;

CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_revision_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'in_review', 'needs_changes', 'accepted', 'waitlisted', 'rejected', 'withdrawn', 'converted', 'conversion_failed')),
    respondent_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    contact_email TEXT NOT NULL DEFAULT '',
    access_token_hash TEXT,
    access_token_expires_at TIMESTAMPTZ,
    access_token_revoked_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_decision_id TEXT,
    deleted_at TIMESTAMPTZ,
    anonymized_at TIMESTAMPTZ,
    anonymization_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, production_id),
    UNIQUE (workspace_id, id, campaign_id),
    UNIQUE (workspace_id, id, campaign_id, production_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, campaign_id, production_id) REFERENCES campaigns(workspace_id, id, production_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, campaign_revision_id, campaign_id) REFERENCES campaign_revisions(workspace_id, id, campaign_id) ON DELETE RESTRICT,
    CHECK (anonymized_at IS NULL OR anonymization_reason IS NOT NULL)
);
CREATE UNIQUE INDEX entries_access_token_hash_unique
    ON entries (access_token_hash)
    WHERE access_token_hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX entries_campaign_inbox_idx
    ON entries (workspace_id, campaign_id, status, submitted_at DESC, id)
    WHERE deleted_at IS NULL;
CREATE INDEX entries_production_status_idx
    ON entries (workspace_id, production_id, status, last_activity_at DESC, id)
    WHERE deleted_at IS NULL;

CREATE TABLE entry_revisions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    answers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
    source TEXT NOT NULL DEFAULT 'public' CHECK (source IN ('public', 'admin', 'import', 'system')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, entry_id, revision_no),
    FOREIGN KEY (workspace_id, entry_id) REFERENCES entries(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX entry_revisions_entry_idx
    ON entry_revisions (workspace_id, entry_id, revision_no DESC);

CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('accept', 'waitlist', 'reject', 'request_changes', 'withdraw', 'cancel')),
    reason TEXT NOT NULL DEFAULT '',
    supersedes_id TEXT,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    decided_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, entry_id),
    FOREIGN KEY (workspace_id, entry_id, campaign_id) REFERENCES entries(workspace_id, id, campaign_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, supersedes_id) REFERENCES decisions(workspace_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX decisions_current_unique
    ON decisions (workspace_id, entry_id)
    WHERE is_current;
CREATE INDEX decisions_entry_history_idx
    ON decisions (workspace_id, entry_id, decided_at DESC, id);

ALTER TABLE entries
    ADD CONSTRAINT entries_current_decision_fk
    FOREIGN KEY (workspace_id, current_decision_id, id)
    REFERENCES decisions(workspace_id, id, entry_id)
    ON DELETE SET NULL;

CREATE TABLE entry_materializations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    decision_id TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('production_registration', 'production_program', 'production_person', 'requirement', 'resource_commitment', 'form_response')),
    operation TEXT NOT NULL CHECK (operation IN ('create', 'link_existing', 'merge', 'skip')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    idempotency_key TEXT NOT NULL,
    target_id TEXT,
    error_code TEXT,
    error_message TEXT,
    requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, entry_id, idempotency_key),
    FOREIGN KEY (workspace_id, entry_id) REFERENCES entries(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, decision_id, entry_id) REFERENCES decisions(workspace_id, id, entry_id) ON DELETE RESTRICT,
    CHECK ((status IN ('succeeded', 'failed') AND completed_at IS NOT NULL) OR status IN ('pending', 'running'))
);
CREATE INDEX entry_materializations_entry_idx
    ON entry_materializations (workspace_id, entry_id, created_at DESC, id);
CREATE INDEX entry_materializations_target_idx
    ON entry_materializations (workspace_id, target_kind, target_id)
    WHERE target_id IS NOT NULL;

CREATE TABLE form_responses (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    form_version_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    answers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redacted')),
    redacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, entry_id),
    FOREIGN KEY (workspace_id, production_id) REFERENCES productions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, campaign_id, production_id) REFERENCES campaigns(workspace_id, id, production_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, entry_id, campaign_id, production_id) REFERENCES entries(workspace_id, id, campaign_id, production_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, form_version_id) REFERENCES form_versions(workspace_id, id) ON DELETE RESTRICT,
    CHECK ((status = 'redacted' AND redacted_at IS NOT NULL) OR (status = 'active' AND redacted_at IS NULL))
);
CREATE INDEX form_responses_campaign_idx
    ON form_responses (workspace_id, campaign_id, created_at DESC, id);

-- Complete provenance constraints now that entries exist.
ALTER TABLE production_programs
    ADD CONSTRAINT production_programs_source_entry_fk
    FOREIGN KEY (workspace_id, source_entry_id, production_id)
    REFERENCES entries(workspace_id, id, production_id)
    ON DELETE RESTRICT;
ALTER TABLE production_people
    ADD CONSTRAINT production_people_source_entry_fk
    FOREIGN KEY (workspace_id, source_entry_id, production_id)
    REFERENCES entries(workspace_id, id, production_id)
    ON DELETE RESTRICT;
ALTER TABLE production_registrations
    ALTER COLUMN entry_id SET NOT NULL;
ALTER TABLE production_registrations
    ADD CONSTRAINT production_registrations_entry_fk
    FOREIGN KEY (workspace_id, entry_id, production_id)
    REFERENCES entries(workspace_id, id, production_id)
    ON DELETE RESTRICT;
CREATE UNIQUE INDEX production_registrations_entry_unique
    ON production_registrations (workspace_id, entry_id);
ALTER TABLE requirements
    ADD CONSTRAINT requirements_source_entry_fk
    FOREIGN KEY (workspace_id, source_entry_id, production_id)
    REFERENCES entries(workspace_id, id, production_id)
    ON DELETE RESTRICT;
ALTER TABLE resource_commitments
    ADD CONSTRAINT resource_commitments_source_entry_fk
    FOREIGN KEY (workspace_id, source_entry_id, production_id)
    REFERENCES entries(workspace_id, id, production_id)
    ON DELETE RESTRICT;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 27}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
