ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS default_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';

UPDATE workspace_settings
SET default_timezone = 'Asia/Shanghai'
WHERE default_timezone IS NULL OR default_timezone = '';

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 24}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
