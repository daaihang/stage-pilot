ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS show_titlebar_title BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS content_width TEXT NOT NULL DEFAULT 'standard'
        CHECK (content_width IN ('standard', 'wide', 'full')),
    ADD COLUMN IF NOT EXISTS sidebar_rail_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS category_tabs_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS floating_action_expand_at_end BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":41}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
