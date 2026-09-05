DROP INDEX IF EXISTS program_types_workspace_sort_order_unique;
DROP INDEX IF EXISTS venue_types_workspace_sort_order_unique;
DROP INDEX IF EXISTS person_types_workspace_sort_order_unique;
DROP INDEX IF EXISTS organization_types_workspace_sort_order_unique;
DROP INDEX IF EXISTS equipment_types_workspace_sort_order_unique;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 18}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
