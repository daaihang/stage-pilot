ALTER TABLE user_preferences
    DROP CONSTRAINT IF EXISTS user_preferences_detail_open_mode_check;

UPDATE user_preferences
SET detail_open_mode = 'exclusive'
WHERE detail_open_mode = 'overlay';

ALTER TABLE user_preferences
    ADD CONSTRAINT user_preferences_detail_open_mode_check
        CHECK (detail_open_mode IN ('inline', 'exclusive'));

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 22}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
