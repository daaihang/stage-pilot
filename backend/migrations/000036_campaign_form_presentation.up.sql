-- Form presentation is a lifecycle surface, not a sortable content block.
ALTER TABLE form_versions
    ADD COLUMN IF NOT EXISTS presentation JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(presentation) = 'object');

-- Backfill the new object without rewriting historical blocks. The API keeps
-- those blocks readable for old snapshots and canonicalizes only new drafts.
WITH legacy_welcome AS (
    SELECT
        fv.id,
        COALESCE(bool_or(block->>'type' = 'welcome'), FALSE) AS enabled,
        COALESCE((array_agg(block->>'title' ORDER BY ordinality) FILTER (WHERE block->>'type' = 'welcome'))[1], '') AS title,
        COALESCE((array_agg(block->>'body' ORDER BY ordinality) FILTER (WHERE block->>'type' = 'welcome'))[1], '') AS body
    FROM form_versions fv
    LEFT JOIN LATERAL jsonb_array_elements(COALESCE(fv.blocks, '[]'::jsonb)) WITH ORDINALITY AS blocks(block, ordinality) ON TRUE
    GROUP BY fv.id
)
UPDATE form_versions fv
SET presentation = jsonb_build_object(
    'public_title', '',
    'welcome', jsonb_build_object(
        'enabled', COALESCE(welcome.enabled, FALSE),
        'title_mode', CASE WHEN COALESCE(welcome.title, '') <> '' THEN 'custom' ELSE 'inherit' END,
        'title_override', COALESCE(welcome.title, ''),
        'description', COALESCE(welcome.body, ''),
        'start_label', '开始填写'
    ),
    'ending', jsonb_build_object(
        'mode', CASE WHEN COALESCE(NULLIF(fv.end_screen->>'title', ''), NULLIF(fv.end_screen->>'body', ''), COALESCE((SELECT block->>'title' FROM jsonb_array_elements(COALESCE(fv.blocks, '[]'::jsonb)) WITH ORDINALITY AS items(block, ordinality) WHERE block->>'type' = 'end' ORDER BY ordinality DESC LIMIT 1), '')) <> '' THEN 'custom' ELSE 'default' END,
        'title', COALESCE(NULLIF(fv.end_screen->>'title', ''), (SELECT block->>'title' FROM jsonb_array_elements(COALESCE(fv.blocks, '[]'::jsonb)) WITH ORDINALITY AS items(block, ordinality) WHERE block->>'type' = 'end' ORDER BY ordinality DESC LIMIT 1), ''),
        'body', COALESCE(NULLIF(fv.end_screen->>'body', ''), (SELECT block->>'body' FROM jsonb_array_elements(COALESCE(fv.blocks, '[]'::jsonb)) WITH ORDINALITY AS items(block, ordinality) WHERE block->>'type' = 'end' ORDER BY ordinality DESC LIMIT 1), ''),
        'redirect_url', ''
    )
)
FROM legacy_welcome welcome
WHERE fv.id = welcome.id AND fv.presentation = '{}'::jsonb;

-- System templates explicitly opt into a welcome screen for respondent-facing
-- workflows; the general collection template remains one-step by default.
UPDATE campaign_template_versions ctv
SET definition = jsonb_set(
    ctv.definition,
    '{form,presentation}',
    CASE ct.kind
        WHEN 'SUBMISSION' THEN '{"public_title":"","welcome":{"enabled":true,"title_mode":"inherit","title_override":"","description":"","start_label":"开始填写"},"ending":{"mode":"default","title":"","body":"","redirect_url":""}}'::jsonb
        WHEN 'RECRUITMENT' THEN '{"public_title":"","welcome":{"enabled":true,"title_mode":"inherit","title_override":"","description":"","start_label":"开始填写"},"ending":{"mode":"default","title":"","body":"","redirect_url":""}}'::jsonb
        WHEN 'REGISTRATION' THEN '{"public_title":"","welcome":{"enabled":true,"title_mode":"inherit","title_override":"","description":"","start_label":"开始填写"},"ending":{"mode":"default","title":"","body":"","redirect_url":""}}'::jsonb
        ELSE '{"public_title":"","welcome":{"enabled":false,"title_mode":"inherit","title_override":"","description":"","start_label":"开始填写"},"ending":{"mode":"default","title":"","body":"","redirect_url":""}}'::jsonb
    END,
    TRUE
)
FROM campaign_templates ct
WHERE ct.id = ctv.template_id AND ct.scope = 'system';

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":36}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
