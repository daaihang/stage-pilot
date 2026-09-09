-- ReviewRecipe V1: reusable, versioned fixed review policies.
-- Runtime review execution is intentionally deferred; Campaign revisions keep
-- an immutable JSON snapshot while this catalog records its reusable source.

CREATE TABLE review_recipe_templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('system', 'workspace')),
    key TEXT NOT NULL CHECK (btrim(key) <> ''),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    latest_version INTEGER NOT NULL DEFAULT 1 CHECK (latest_version >= 1),
    source_template_id TEXT REFERENCES review_recipe_templates(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    CHECK ((scope = 'system' AND workspace_id IS NULL AND created_by IS NULL)
        OR (scope = 'workspace' AND workspace_id IS NOT NULL AND created_by IS NOT NULL))
);

CREATE UNIQUE INDEX review_recipe_templates_scope_key_unique
    ON review_recipe_templates (COALESCE(workspace_id, ''), key)
    WHERE archived_at IS NULL;

CREATE INDEX review_recipe_templates_scope_status_idx
    ON review_recipe_templates (scope, workspace_id, status, updated_at DESC, id)
    WHERE archived_at IS NULL;

CREATE TABLE review_recipe_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES review_recipe_templates(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 1),
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
    definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    UNIQUE (template_id, version),
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, template_id)
        REFERENCES review_recipe_templates(workspace_id, id)
        ON DELETE CASCADE,
    CHECK ((workspace_id IS NULL AND created_by IS NULL)
        OR (workspace_id IS NOT NULL AND created_by IS NOT NULL))
);

CREATE INDEX review_recipe_versions_template_idx
    ON review_recipe_versions (template_id, version DESC);

CREATE FUNCTION enforce_review_recipe_version_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    template_workspace_id TEXT;
BEGIN
    SELECT workspace_id INTO template_workspace_id
    FROM review_recipe_templates
    WHERE id = NEW.template_id;
    IF NOT FOUND OR NEW.workspace_id IS DISTINCT FROM template_workspace_id THEN
        RAISE EXCEPTION 'review recipe version workspace does not match its template'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER review_recipe_versions_scope
    BEFORE INSERT OR UPDATE OF template_id, workspace_id
    ON review_recipe_versions
    FOR EACH ROW EXECUTE FUNCTION enforce_review_recipe_version_scope();

-- Recipe versions are immutable snapshots. The trigger protects the
-- immutability invariant even if a future maintenance job bypasses the API.
CREATE FUNCTION prevent_review_recipe_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'review recipe versions are immutable'
        USING ERRCODE = '55000';
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER review_recipe_versions_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_review_recipe_version_mutation();

CREATE FUNCTION prevent_system_review_recipe_template_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.scope = 'system' THEN
        RAISE EXCEPTION 'system review recipe templates are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER review_recipe_templates_system_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_templates
    FOR EACH ROW EXECUTE FUNCTION prevent_system_review_recipe_template_mutation();

ALTER TABLE campaign_template_versions
    ADD COLUMN review_recipe_version_id TEXT
    REFERENCES review_recipe_versions(id) ON DELETE RESTRICT;

ALTER TABLE campaign_revisions
    ADD COLUMN review_recipe_version_id TEXT
    REFERENCES review_recipe_versions(id) ON DELETE RESTRICT;

-- A simple FK cannot express "system recipe or same-workspace recipe".
-- Enforce that tenant rule for both Campaign template and Revision sources.
CREATE FUNCTION enforce_review_recipe_reference_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    recipe_workspace_id TEXT;
BEGIN
    IF NEW.review_recipe_version_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT workspace_id INTO recipe_workspace_id
    FROM review_recipe_versions
    WHERE id = NEW.review_recipe_version_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'review recipe version does not exist'
            USING ERRCODE = '23503';
    END IF;
    IF recipe_workspace_id IS NOT NULL
       AND NEW.workspace_id IS DISTINCT FROM recipe_workspace_id THEN
        RAISE EXCEPTION 'review recipe version belongs to another workspace'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_template_versions_review_recipe_scope
    BEFORE INSERT OR UPDATE OF review_recipe_version_id, workspace_id
    ON campaign_template_versions
    FOR EACH ROW EXECUTE FUNCTION enforce_review_recipe_reference_scope();

CREATE TRIGGER campaign_revisions_review_recipe_scope
    BEFORE INSERT OR UPDATE OF review_recipe_version_id, workspace_id
    ON campaign_revisions
    FOR EACH ROW EXECUTE FUNCTION enforce_review_recipe_reference_scope();

-- Built-in recipes are immutable starting points. Reviewer references are
-- intentionally unbound here; a Campaign revision supplies members or roles
-- before publication.
INSERT INTO review_recipe_templates (
    id, scope, key, name, description, status, latest_version, created_by
) VALUES
    ('review_recipe_auto_accept', 'system', 'auto_accept', '无审核 / 自动确认', '提交后直接确认，适合低风险活动报名。', 'published', 1, NULL),
    ('review_recipe_single_manual', 'system', 'single_manual', '单轮人工审核', '一轮人工审核，完成后等待最终决定。', 'published', 1, NULL),
    ('review_recipe_parallel_panel', 'system', 'parallel_panel', '平行审核', '同一轮内由多名审核人并行审核。', 'published', 1, NULL),
    ('review_recipe_multi_stage', 'system', 'multi_stage', '多轮审核', '多个固定审核轮次按顺序推进。', 'published', 1, NULL),
    ('review_recipe_multi_stage_scored', 'system', 'multi_stage_scored', '多轮评分审核', '多轮审核中至少一轮使用评分量表。', 'published', 1, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO review_recipe_versions (
    id, template_id, workspace_id, version, schema_version, definition, created_by, published_at
) VALUES
    (
        'review_recipe_auto_accept_v1', 'review_recipe_auto_accept', NULL, 1, 1,
        '{
          "schema_version": 1,
          "mode": "AUTO_ACCEPT",
          "rounds": [],
          "request_changes": {"enabled": false, "target": "same_round"},
          "final_decision": "auto_accept"
        }'::jsonb,
        NULL, NOW()
    ),
    (
        'review_recipe_single_manual_v1', 'review_recipe_single_manual', NULL, 1, 1,
        '{
          "schema_version": 1,
          "mode": "MANUAL_DECISION",
          "rounds": [{
            "key": "review",
            "name": "人工审核",
            "execution": "parallel",
            "reviewer_policy": {"source": "explicit_members", "member_ids": [], "role_keys": []},
            "completion": {"mode": "all"},
            "feedback": {"kind": "binary"}
          }],
          "request_changes": {"enabled": true, "target": "same_round"},
          "final_decision": "manual"
        }'::jsonb,
        NULL, NOW()
    ),
    (
        'review_recipe_parallel_panel_v1', 'review_recipe_parallel_panel', NULL, 1, 1,
        '{
          "schema_version": 1,
          "mode": "MANUAL_DECISION",
          "rounds": [{
            "key": "panel",
            "name": "平行评审",
            "execution": "parallel",
            "reviewer_policy": {"source": "explicit_members", "member_ids": [], "role_keys": []},
            "completion": {"mode": "at_least_n", "n": 1},
            "feedback": {"kind": "binary"}
          }],
          "request_changes": {"enabled": true, "target": "same_round"},
          "final_decision": "manual"
        }'::jsonb,
        NULL, NOW()
    ),
    (
        'review_recipe_multi_stage_v1', 'review_recipe_multi_stage', NULL, 1, 1,
        '{
          "schema_version": 1,
          "mode": "MULTI_STAGE_REVIEW",
          "rounds": [
            {
              "key": "qualification",
              "name": "资格筛选",
              "execution": "parallel",
              "reviewer_policy": {"source": "production_roles", "member_ids": [], "role_keys": []},
              "completion": {"mode": "all"},
              "feedback": {"kind": "binary"}
            },
            {
              "key": "professional",
              "name": "专业审核",
              "execution": "parallel",
              "reviewer_policy": {"source": "production_roles", "member_ids": [], "role_keys": []},
              "completion": {"mode": "all"},
              "feedback": {"kind": "binary"}
            }
          ],
          "request_changes": {"enabled": true, "target": "same_round"},
          "final_decision": "manual"
        }'::jsonb,
        NULL, NOW()
    ),
    (
        'review_recipe_multi_stage_scored_v1', 'review_recipe_multi_stage_scored', NULL, 1, 1,
        '{
          "schema_version": 1,
          "mode": "MULTI_STAGE_REVIEW",
          "rounds": [
            {
              "key": "qualification",
              "name": "资格筛选",
              "execution": "parallel",
              "reviewer_policy": {"source": "production_roles", "member_ids": [], "role_keys": []},
              "completion": {"mode": "all"},
              "feedback": {"kind": "binary"}
            },
            {
              "key": "scoring",
              "name": "内容评分",
              "execution": "parallel",
              "reviewer_policy": {"source": "production_roles", "member_ids": [], "role_keys": []},
              "completion": {"mode": "all"},
              "feedback": {"kind": "score"},
              "scorecard": {"criteria": [
                {"key": "quality", "label": "内容质量", "description": "", "scale_min": 1, "scale_max": 5, "weight": 50},
                {"key": "feasibility", "label": "执行可行性", "description": "", "scale_min": 1, "scale_max": 5, "weight": 50}
              ]}
            }
          ],
          "request_changes": {"enabled": true, "target": "same_round"},
          "final_decision": "manual"
        }'::jsonb,
        NULL, NOW()
    )
ON CONFLICT (id) DO NOTHING;

-- Existing system Campaign templates now point at the corresponding recipe
-- source while retaining their complete review_workflow snapshot.
UPDATE campaign_template_versions
SET review_recipe_version_id = CASE template_id
    WHEN 'system_program_submission' THEN 'review_recipe_multi_stage_scored_v1'
    WHEN 'system_crew_recruitment' THEN 'review_recipe_single_manual_v1'
    WHEN 'system_event_registration' THEN 'review_recipe_auto_accept_v1'
    WHEN 'system_general_collection' THEN 'review_recipe_auto_accept_v1'
    ELSE review_recipe_version_id
END
WHERE template_id IN (
    'system_program_submission',
    'system_crew_recruitment',
    'system_event_registration',
    'system_general_collection'
);

-- Replace legacy stage labels in the four built-ins with the V1 snapshot shape.
UPDATE campaign_template_versions
SET definition = jsonb_set(
    definition,
    '{review_workflow}',
    CASE template_id
        WHEN 'system_program_submission' THEN '{
          "schema_version": 1,
          "mode": "MULTI_STAGE_REVIEW",
          "rounds": [
            {"key":"qualification","name":"资格筛选","execution":"parallel","reviewer_policy":{"source":"production_roles","member_ids":[],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}},
            {"key":"scoring","name":"内容评分","execution":"parallel","reviewer_policy":{"source":"production_roles","member_ids":[],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"score"},"scorecard":{"criteria":[{"key":"quality","label":"内容质量","description":"","scale_min":1,"scale_max":5,"weight":50},{"key":"feasibility","label":"执行可行性","description":"","scale_min":1,"scale_max":5,"weight":50}]}}
          ],
          "request_changes":{"enabled":true,"target":"same_round"},
          "final_decision":"manual"
        }'::jsonb
        WHEN 'system_crew_recruitment' THEN '{
          "schema_version": 1,
          "mode": "MANUAL_DECISION",
          "rounds": [{"key":"screening","name":"资格筛选","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":[],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}}],
          "request_changes":{"enabled":true,"target":"same_round"},
          "final_decision":"manual"
        }'::jsonb
        WHEN 'system_event_registration' THEN '{
          "schema_version": 1,
          "mode": "AUTO_ACCEPT",
          "rounds": [],
          "request_changes":{"enabled":false,"target":"same_round"},
          "final_decision":"auto_accept"
        }'::jsonb
        WHEN 'system_general_collection' THEN '{
          "schema_version": 1,
          "mode": "AUTO_ACCEPT",
          "rounds": [],
          "request_changes":{"enabled":false,"target":"same_round"},
          "final_decision":"auto_accept"
        }'::jsonb
        ELSE definition->'review_workflow'
    END,
    TRUE
)
WHERE template_id IN (
    'system_program_submission',
    'system_crew_recruitment',
    'system_event_registration',
    'system_general_collection'
);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 30}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
