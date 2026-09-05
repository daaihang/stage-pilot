-- Classification backfill is intentionally forward-only.  This only restores
-- the nullable schema shape; it does not discard the assigned “other” values.
ALTER TABLE programs ALTER COLUMN program_type_id DROP NOT NULL;
ALTER TABLE venues ALTER COLUMN venue_type_id DROP NOT NULL;
ALTER TABLE people ALTER COLUMN person_type_id DROP NOT NULL;
ALTER TABLE organizations ALTER COLUMN organization_type_id DROP NOT NULL;
ALTER TABLE equipment_items ALTER COLUMN equipment_type_id DROP NOT NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 17}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
