DROP TRIGGER IF EXISTS review_recipe_versions_immutable ON review_recipe_versions;
DROP FUNCTION IF EXISTS prevent_published_review_recipe_version_mutation();

CREATE FUNCTION prevent_review_recipe_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'review recipe versions are immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER review_recipe_versions_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_review_recipe_version_mutation();

DROP INDEX IF EXISTS review_recipe_versions_one_draft_unique;
DROP INDEX IF EXISTS campaign_template_versions_one_draft_unique;
DROP TRIGGER IF EXISTS campaign_template_versions_immutable ON campaign_template_versions;
DROP FUNCTION IF EXISTS prevent_published_campaign_template_version_mutation();
DROP TRIGGER IF EXISTS campaign_templates_source_scope ON campaign_templates;
DROP FUNCTION IF EXISTS enforce_campaign_template_source_scope();
DROP TRIGGER IF EXISTS campaign_template_versions_scope ON campaign_template_versions;
DROP FUNCTION IF EXISTS enforce_campaign_template_version_scope();

DROP TRIGGER IF EXISTS review_recipe_templates_source_scope ON review_recipe_templates;
DROP FUNCTION IF EXISTS enforce_review_recipe_template_source_scope();

ALTER TABLE review_recipe_templates DROP CONSTRAINT IF EXISTS review_recipe_templates_published_version_fk;
ALTER TABLE campaign_templates DROP CONSTRAINT IF EXISTS campaign_templates_source_revision_pair_check;
ALTER TABLE campaign_templates DROP CONSTRAINT IF EXISTS campaign_templates_source_revision_fk;
ALTER TABLE campaign_templates DROP CONSTRAINT IF EXISTS campaign_templates_source_campaign_fk;
ALTER TABLE campaign_templates DROP CONSTRAINT IF EXISTS campaign_templates_published_version_fk;
ALTER TABLE review_recipe_templates DROP COLUMN IF EXISTS published_version;
ALTER TABLE campaign_template_versions DROP COLUMN IF EXISTS published_at;
ALTER TABLE campaign_templates DROP COLUMN IF EXISTS published_version;
ALTER TABLE campaign_templates DROP COLUMN IF EXISTS source_campaign_revision_id;
ALTER TABLE campaign_templates DROP COLUMN IF EXISTS source_campaign_id;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":36}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
