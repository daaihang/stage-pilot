DROP INDEX IF EXISTS resource_commitments_requirement_idx;
DROP INDEX IF EXISTS resource_commitments_production_status_idx;
DROP TABLE IF EXISTS resource_commitments;
DROP INDEX IF EXISTS requirements_production_status_idx;
DROP TABLE IF EXISTS requirements;
DROP INDEX IF EXISTS production_registrations_production_idx;
DROP TABLE IF EXISTS production_registrations;
DROP INDEX IF EXISTS production_people_production_idx;
DROP INDEX IF EXISTS production_people_linked_person_unique;
DROP TABLE IF EXISTS production_people;
DROP INDEX IF EXISTS production_programs_production_idx;
DROP TABLE IF EXISTS production_programs;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 25}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
