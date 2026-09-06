ALTER TABLE user_preferences
    DROP CONSTRAINT IF EXISTS user_preferences_detail_open_mode_check;

UPDATE user_preferences
SET detail_open_mode = 'overlay'
WHERE detail_open_mode = 'exclusive';

ALTER TABLE user_preferences
    ADD CONSTRAINT user_preferences_detail_open_mode_check
        CHECK (detail_open_mode IN ('inline', 'overlay'));

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 21}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
