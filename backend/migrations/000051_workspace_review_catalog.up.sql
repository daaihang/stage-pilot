ALTER TABLE workspace_settings
    ADD COLUMN enabled_review_recipe_keys TEXT[] NOT NULL DEFAULT ARRAY['single_manual']::TEXT[],
    ADD COLUMN default_review_recipe_key TEXT NOT NULL DEFAULT 'single_manual';

INSERT INTO workspace_settings (workspace_id)
SELECT id FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

ALTER TABLE workspace_settings
    ADD CONSTRAINT workspace_settings_review_catalog_nonempty
        CHECK (cardinality(enabled_review_recipe_keys) > 0),
    ADD CONSTRAINT workspace_settings_review_default_enabled
        CHECK (default_review_recipe_key = ANY(enabled_review_recipe_keys));

INSERT INTO app_metadata(key, value)
VALUES ('schema', '{"version":51}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
