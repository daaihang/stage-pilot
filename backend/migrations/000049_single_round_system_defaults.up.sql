-- Publish executable P1 starting points without rewriting immutable v1 seeds.
-- The three future processing modes remain historical data, not choices for new work.

INSERT INTO review_recipe_versions (
    id, template_id, workspace_id, version, schema_version, definition, created_by, published_at
) VALUES (
    'review_recipe_single_manual_v2', 'review_recipe_single_manual', NULL, 2, 1,
    '{
      "schema_version": 1,
      "mode": "MANUAL_DECISION",
      "rounds": [{
        "key": "review", "name": "单轮审核", "execution": "parallel",
        "reviewer_policy": {"source": "explicit_members", "member_ids": [], "role_keys": []},
        "completion": {"mode": "all"}, "feedback": {"kind": "binary"}
      }],
      "request_changes": {"enabled": false, "target": "same_round"},
      "final_decision": "manual"
    }'::jsonb, NULL, NOW()
);

DROP TRIGGER review_recipe_templates_system_immutable ON review_recipe_templates;
UPDATE review_recipe_templates
SET latest_version = 2, published_version = 2, updated_at = NOW()
WHERE id = 'review_recipe_single_manual';
UPDATE review_recipe_templates
SET status = 'archived', archived_at = NOW(), updated_at = NOW()
WHERE id IN ('review_recipe_auto_accept', 'review_recipe_parallel_panel',
             'review_recipe_multi_stage', 'review_recipe_multi_stage_scored');
CREATE TRIGGER review_recipe_templates_system_immutable
    BEFORE UPDATE OR DELETE ON review_recipe_templates
    FOR EACH ROW EXECUTE FUNCTION prevent_system_review_recipe_template_mutation();

-- Copy the published system templates into new immutable versions. Their
-- original definitions and provenance remain available for existing records.
INSERT INTO campaign_template_versions (
    id, template_id, workspace_id, version, definition, review_recipe_version_id,
    created_by, published_at
)
SELECT t.id || '_v3', t.id, NULL, 3,
    CASE t.id
      WHEN 'system_program_submission' THEN
        jsonb_set(
          jsonb_set(
            jsonb_set(v.definition, '{review_workflow}', recipe.definition, true),
            '{form,fields}',
            (SELECT jsonb_agg(
                CASE WHEN field->>'id' = 'demo'
                  THEN (field - 'semantic_key') || '{"type":"url","label":"Demo 链接"}'::jsonb
                  ELSE field END ORDER BY ordinal
              ) FROM jsonb_array_elements(v.definition->'form'->'fields')
                WITH ORDINALITY AS fields(field, ordinal)), true),
          '{metadata,tags}', '["节目","Demo 链接","单轮审核"]'::jsonb, true)
      WHEN 'system_crew_recruitment' THEN
        jsonb_set(
          jsonb_set(v.definition, '{review_workflow}', recipe.definition, true),
          '{form,fields}',
          (SELECT jsonb_agg(
              CASE WHEN field->>'id' = 'roles'
                THEN field || '{"type":"text"}'::jsonb
                ELSE field END ORDER BY ordinal
            ) FROM jsonb_array_elements(v.definition->'form'->'fields')
              WITH ORDINALITY AS fields(field, ordinal)), true)
      ELSE jsonb_set(v.definition, '{review_workflow}', recipe.definition, true)
    END,
    recipe.id, NULL, NOW()
FROM campaign_templates t
JOIN campaign_template_versions v ON v.template_id = t.id AND v.version = 2
CROSS JOIN review_recipe_versions recipe
WHERE t.id IN ('system_program_submission', 'system_crew_recruitment',
               'system_event_registration', 'system_general_collection')
  AND recipe.id = 'review_recipe_single_manual_v2';

DROP TRIGGER campaign_templates_system_immutable ON campaign_templates;
UPDATE campaign_templates
SET latest_version = 3, published_version = 3, updated_at = NOW(),
    description = CASE WHEN id = 'system_program_submission'
      THEN '节目名称、演出者、时长、Demo 链接和舞台需求。'
      ELSE description END
WHERE id IN ('system_program_submission', 'system_crew_recruitment',
             'system_event_registration', 'system_general_collection');
CREATE TRIGGER campaign_templates_system_immutable
    BEFORE UPDATE OR DELETE ON campaign_templates
    FOR EACH ROW EXECUTE FUNCTION prevent_system_campaign_template_mutation();

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":49}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
