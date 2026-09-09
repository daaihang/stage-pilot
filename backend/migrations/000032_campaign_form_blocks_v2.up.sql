-- Campaign FormVersion V1.1: every field has exactly one field block.
-- Historical v1 snapshots remain intact; v2 is a new immutable template
-- snapshot whose block order is the public renderer order.

WITH source AS (
    SELECT
        ctv.id,
        ctv.template_id,
        ctv.workspace_id,
        ctv.review_recipe_version_id,
        ctv.definition,
        ctv.created_by
    FROM campaign_template_versions ctv
    WHERE ctv.version = 1
      AND ctv.template_id IN (
        'system_program_submission',
        'system_crew_recruitment',
        'system_event_registration',
        'system_general_collection'
      )
), normalized AS (
    SELECT
        source.*,
        (
            COALESCE(source.definition->'form'->'blocks', '[]'::jsonb)
            || COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', 'field_' || (field->>'id'),
                        'type', 'field',
                        'field_key', field->>'id'
                    ) ORDER BY field_order
                )
                FROM jsonb_array_elements(COALESCE(source.definition->'form'->'fields', '[]'::jsonb))
                    WITH ORDINALITY AS fields(field, field_order)
                WHERE COALESCE(field->>'id', '') <> ''
                  AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(source.definition->'form'->'blocks', '[]'::jsonb)) existing_block
                    WHERE existing_block->>'type' = 'field'
                      AND existing_block->>'field_key' = field->>'id'
                  )
            ), '[]'::jsonb)
        ) AS blocks
    FROM source
)
INSERT INTO campaign_template_versions (id, template_id, workspace_id, version, definition, created_by, review_recipe_version_id)
SELECT
    replace(normalized.id, '_v1', '_v2'),
    normalized.template_id,
    normalized.workspace_id,
    2,
    jsonb_set(normalized.definition, '{form,blocks}', normalized.blocks, true),
    normalized.created_by,
    normalized.review_recipe_version_id
FROM normalized
ON CONFLICT (id) DO NOTHING;

UPDATE campaign_templates
SET latest_version = 2,
    updated_at = NOW()
WHERE scope = 'system'
  AND id IN (
    'system_program_submission',
    'system_crew_recruitment',
    'system_event_registration',
    'system_general_collection'
  );

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":32}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
