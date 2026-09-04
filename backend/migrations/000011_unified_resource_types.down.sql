ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_workspace_venue_type_fk;
ALTER TABLE venues DROP COLUMN IF EXISTS venue_type_id;
DROP TABLE IF EXISTS venue_types;
DROP TABLE IF EXISTS venue_type_templates;
