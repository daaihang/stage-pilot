ALTER TABLE user_preferences
    DROP COLUMN IF EXISTS floating_action_expand_at_end,
    DROP COLUMN IF EXISTS category_tabs_pinned,
    DROP COLUMN IF EXISTS sidebar_rail_enabled,
    DROP COLUMN IF EXISTS content_width,
    DROP COLUMN IF EXISTS show_titlebar_title;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":40}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
