UPDATE form_versions
SET end_screen = jsonb_build_object(
    'title', COALESCE(presentation->'ending'->>'title', ''),
    'body', COALESCE(presentation->'ending'->>'body', '')
)
WHERE presentation IS NOT NULL;

ALTER TABLE form_versions DROP COLUMN IF EXISTS presentation;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":35}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
