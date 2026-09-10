DROP TABLE IF EXISTS program_sheet_segment_types;
DROP TABLE IF EXISTS program_sheet_segment_type_templates;
ALTER TABLE program_sheet_releases DROP COLUMN IF EXISTS retract_note;
ALTER TABLE program_sheet_releases DROP COLUMN IF EXISTS retracted_by;
ALTER TABLE program_sheet_releases DROP COLUMN IF EXISTS retracted_at;
INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":34}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
