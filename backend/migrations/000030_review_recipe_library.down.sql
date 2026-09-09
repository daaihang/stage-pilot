DROP TRIGGER IF EXISTS campaign_revisions_review_recipe_scope ON campaign_revisions;
DROP TRIGGER IF EXISTS campaign_template_versions_review_recipe_scope ON campaign_template_versions;
DROP FUNCTION IF EXISTS enforce_review_recipe_reference_scope();

ALTER TABLE campaign_revisions
    DROP CONSTRAINT IF EXISTS campaign_revisions_review_recipe_version_id_fkey;
ALTER TABLE campaign_revisions
    DROP COLUMN IF EXISTS review_recipe_version_id;

ALTER TABLE campaign_template_versions
    DROP CONSTRAINT IF EXISTS campaign_template_versions_review_recipe_version_id_fkey;
ALTER TABLE campaign_template_versions
    DROP COLUMN IF EXISTS review_recipe_version_id;

DROP TRIGGER IF EXISTS review_recipe_versions_immutable ON review_recipe_versions;
DROP TRIGGER IF EXISTS review_recipe_versions_scope ON review_recipe_versions;
DROP TRIGGER IF EXISTS review_recipe_templates_system_immutable ON review_recipe_templates;
DROP FUNCTION IF EXISTS prevent_review_recipe_version_mutation();
DROP FUNCTION IF EXISTS prevent_system_review_recipe_template_mutation();
DROP FUNCTION IF EXISTS enforce_review_recipe_version_scope();

DROP INDEX IF EXISTS review_recipe_versions_template_idx;
DROP TABLE IF EXISTS review_recipe_versions;
DROP INDEX IF EXISTS review_recipe_templates_scope_status_idx;
DROP INDEX IF EXISTS review_recipe_templates_scope_key_unique;
DROP TABLE IF EXISTS review_recipe_templates;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 29}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
