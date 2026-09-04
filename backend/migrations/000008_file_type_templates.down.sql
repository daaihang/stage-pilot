DROP TABLE IF EXISTS file_types;
DROP TABLE IF EXISTS file_type_templates;
DROP INDEX IF EXISTS program_types_workspace_system_key_unique;
ALTER TABLE program_types
    DROP COLUMN IF EXISTS system_key,
    DROP COLUMN IF EXISTS is_system_default;
DROP TABLE IF EXISTS program_type_templates;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 7}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
