DROP TABLE IF EXISTS schedule_item_locations;
DROP TABLE IF EXISTS schedule_items;
ALTER TABLE rehearsal_sessions DROP CONSTRAINT IF EXISTS rehearsal_sessions_workspace_id_id_production_unique;
ALTER TABLE production_settings DROP COLUMN IF EXISTS schedule_conflict_policy;
ALTER TABLE workspace_settings DROP COLUMN IF EXISTS schedule_conflict_policy;
