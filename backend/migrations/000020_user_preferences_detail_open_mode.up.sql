ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS detail_open_mode TEXT NOT NULL DEFAULT 'inline'
        CHECK (detail_open_mode IN ('inline', 'overlay'));

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 20}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
