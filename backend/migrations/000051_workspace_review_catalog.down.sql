DELETE FROM app_metadata WHERE key='schema' AND value->>'version'='51';

ALTER TABLE workspace_settings
    DROP CONSTRAINT IF EXISTS workspace_settings_review_default_enabled,
    DROP CONSTRAINT IF EXISTS workspace_settings_review_catalog_nonempty,
    DROP COLUMN IF EXISTS default_review_recipe_key,
    DROP COLUMN IF EXISTS enabled_review_recipe_keys;

INSERT INTO app_metadata(key, value)
VALUES ('schema', '{"version":50}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
