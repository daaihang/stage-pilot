-- Downgrade is possible only while no Campaign or workspace template uses the
-- new published versions; foreign keys deliberately protect live snapshots.
DROP TRIGGER campaign_templates_system_immutable ON campaign_templates;
UPDATE campaign_templates
SET latest_version = 2, published_version = 2, updated_at = NOW(),
    description = CASE WHEN id = 'system_program_submission'
      THEN '节目名称、演出者、时长、附件和舞台需求。'
      ELSE description END
WHERE id IN ('system_program_submission', 'system_crew_recruitment',
             'system_event_registration', 'system_general_collection');
CREATE TRIGGER campaign_templates_system_immutable
    BEFORE UPDATE OR DELETE ON campaign_templates
    FOR EACH ROW EXECUTE FUNCTION prevent_system_campaign_template_mutation();

DROP TRIGGER campaign_template_versions_immutable ON campaign_template_versions;
DROP TRIGGER campaign_template_versions_system_immutable ON campaign_template_versions;
DELETE FROM campaign_template_versions
WHERE id IN ('system_program_submission_v3', 'system_crew_recruitment_v3',
             'system_event_registration_v3', 'system_general_collection_v3');
CREATE TRIGGER campaign_template_versions_immutable
    BEFORE UPDATE OR DELETE ON campaign_template_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_published_campaign_template_version_mutation();
CREATE TRIGGER campaign_template_versions_system_immutable
    BEFORE UPDATE OR DELETE ON campaign_template_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_system_campaign_template_version_mutation();

DROP TRIGGER review_recipe_templates_system_immutable ON review_recipe_templates;
UPDATE review_recipe_templates
SET latest_version = 1, published_version = 1, updated_at = NOW()
WHERE id = 'review_recipe_single_manual';
UPDATE review_recipe_templates
SET status = 'published', archived_at = NULL, updated_at = NOW()
WHERE id IN ('review_recipe_auto_accept', 'review_recipe_parallel_panel',
             'review_recipe_multi_stage', 'review_recipe_multi_stage_scored');
CREATE TRIGGER review_recipe_templates_system_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_templates
    FOR EACH ROW EXECUTE FUNCTION prevent_system_review_recipe_template_mutation();

DROP TRIGGER review_recipe_versions_immutable ON review_recipe_versions;
DELETE FROM review_recipe_versions WHERE id = 'review_recipe_single_manual_v2';
CREATE TRIGGER review_recipe_versions_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_published_review_recipe_version_mutation();

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":48}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
