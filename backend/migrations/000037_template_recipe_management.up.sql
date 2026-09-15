-- Workspace template and review recipe management.
-- Draft versions are editable; published versions are immutable snapshots.

ALTER TABLE campaign_templates
    ADD COLUMN IF NOT EXISTS published_version INTEGER,
    ADD COLUMN IF NOT EXISTS source_campaign_id TEXT,
    ADD COLUMN IF NOT EXISTS source_campaign_revision_id TEXT;

ALTER TABLE campaign_template_versions
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE campaign_templates
    ADD CONSTRAINT campaign_templates_published_version_fk
    FOREIGN KEY (id, published_version) REFERENCES campaign_template_versions(template_id, version)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE campaign_templates
    ADD CONSTRAINT campaign_templates_source_campaign_fk
    FOREIGN KEY (workspace_id, source_campaign_id) REFERENCES campaigns(workspace_id, id) ON DELETE SET NULL (source_campaign_id);

ALTER TABLE campaign_templates
    ADD CONSTRAINT campaign_templates_source_revision_fk
    FOREIGN KEY (workspace_id, source_campaign_revision_id) REFERENCES campaign_revisions(workspace_id, id) ON DELETE SET NULL (source_campaign_revision_id);

ALTER TABLE campaign_templates
    ADD CONSTRAINT campaign_templates_source_revision_pair_check
    CHECK (source_campaign_revision_id IS NULL OR source_campaign_id IS NOT NULL);

UPDATE campaign_template_versions ctv
SET published_at = COALESCE(ctv.created_at, NOW())
FROM campaign_templates ct
WHERE ctv.template_id = ct.id
  AND ct.scope = 'system'
  AND ctv.published_at IS NULL;

UPDATE campaign_template_versions ctv
SET published_at = COALESCE(ctv.created_at, NOW())
FROM campaign_templates ct
WHERE ctv.template_id = ct.id
  AND ct.scope = 'workspace'
  AND (ct.status = 'published' OR ctv.version < ct.latest_version)
  AND ctv.published_at IS NULL;

UPDATE campaign_templates
SET published_version = latest_version
WHERE status = 'published' AND published_version IS NULL;

CREATE UNIQUE INDEX campaign_template_versions_one_draft_unique
    ON campaign_template_versions (template_id)
    WHERE published_at IS NULL;

CREATE FUNCTION enforce_campaign_template_version_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    template_workspace_id TEXT;
BEGIN
    SELECT workspace_id INTO template_workspace_id
    FROM campaign_templates WHERE id = NEW.template_id;
    IF NOT FOUND OR NEW.workspace_id IS DISTINCT FROM template_workspace_id THEN
        RAISE EXCEPTION 'campaign template version workspace does not match its template'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_template_versions_scope
    BEFORE INSERT OR UPDATE OF template_id, workspace_id
    ON campaign_template_versions
    FOR EACH ROW EXECUTE FUNCTION enforce_campaign_template_version_scope();

CREATE FUNCTION prevent_published_campaign_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.published_at IS NOT NULL THEN
		RAISE EXCEPTION 'published campaign template versions are immutable'
			USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_template_versions_immutable
    BEFORE UPDATE OR DELETE ON campaign_template_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_published_campaign_template_version_mutation();

CREATE FUNCTION prevent_system_campaign_template_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.scope = 'system' THEN
        RAISE EXCEPTION 'system campaign templates are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_templates_system_immutable
    BEFORE UPDATE OR DELETE ON campaign_templates
    FOR EACH ROW EXECUTE FUNCTION prevent_system_campaign_template_mutation();

CREATE FUNCTION prevent_system_campaign_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.workspace_id IS NULL THEN
        RAISE EXCEPTION 'system campaign template versions are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_template_versions_system_immutable
    BEFORE UPDATE OR DELETE ON campaign_template_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_system_campaign_template_version_mutation();

CREATE FUNCTION enforce_campaign_template_source_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_scope TEXT;
    source_workspace_id TEXT;
BEGIN
    IF NEW.source_template_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT scope, workspace_id INTO source_scope, source_workspace_id
    FROM campaign_templates WHERE id = NEW.source_template_id;
    IF NOT FOUND OR (source_scope <> 'system' AND source_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
        RAISE EXCEPTION 'campaign template source belongs to another workspace'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_templates_source_scope
    BEFORE INSERT OR UPDATE OF source_template_id, workspace_id
    ON campaign_templates
    FOR EACH ROW EXECUTE FUNCTION enforce_campaign_template_source_scope();

ALTER TABLE review_recipe_templates
    ADD COLUMN IF NOT EXISTS published_version INTEGER;

-- System recipe templates are read-only at runtime. Temporarily suspend that
-- guard while backfilling the new published pointer, then recreate it below.
DROP TRIGGER IF EXISTS review_recipe_templates_system_immutable ON review_recipe_templates;

UPDATE review_recipe_templates
SET published_version = latest_version
WHERE status = 'published' AND published_version IS NULL;

UPDATE review_recipe_versions rv
SET published_at = COALESCE(rv.created_at, NOW())
FROM review_recipe_templates rt
WHERE rv.template_id = rt.id
  AND (rt.scope = 'system' OR rt.status = 'published' OR rv.version < rt.latest_version)
  AND rv.published_at IS NULL;

ALTER TABLE review_recipe_templates
    ADD CONSTRAINT review_recipe_templates_published_version_fk
    FOREIGN KEY (id, published_version) REFERENCES review_recipe_versions(template_id, version)
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX review_recipe_versions_one_draft_unique
    ON review_recipe_versions (template_id)
    WHERE published_at IS NULL;

DROP TRIGGER IF EXISTS review_recipe_versions_immutable ON review_recipe_versions;
DROP FUNCTION IF EXISTS prevent_review_recipe_version_mutation();

CREATE FUNCTION prevent_published_review_recipe_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.published_at IS NOT NULL THEN
		RAISE EXCEPTION 'published review recipe versions are immutable'
			USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER review_recipe_versions_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_published_review_recipe_version_mutation();

CREATE TRIGGER review_recipe_templates_system_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_templates
    FOR EACH ROW EXECUTE FUNCTION prevent_system_review_recipe_template_mutation();

CREATE FUNCTION enforce_review_recipe_template_source_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_scope TEXT;
    source_workspace_id TEXT;
BEGIN
    IF NEW.source_template_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT scope, workspace_id INTO source_scope, source_workspace_id
    FROM review_recipe_templates WHERE id = NEW.source_template_id;
    IF NOT FOUND OR (source_scope <> 'system' AND source_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
        RAISE EXCEPTION 'review recipe source belongs to another workspace'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER review_recipe_templates_source_scope
    BEFORE INSERT OR UPDATE OF source_template_id, workspace_id
    ON review_recipe_templates
    FOR EACH ROW EXECUTE FUNCTION enforce_review_recipe_template_source_scope();

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":37}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
