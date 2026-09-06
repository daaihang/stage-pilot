-- Activity scheduling has one canonical timezone on productions.  Child
-- planning records store instants only; their timezone is derived at read time.
ALTER TABLE production_occurrences DROP COLUMN IF EXISTS timezone;
ALTER TABLE rehearsal_sessions DROP COLUMN IF EXISTS timezone;
ALTER TABLE schedule_items DROP COLUMN IF EXISTS timezone;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 21}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
