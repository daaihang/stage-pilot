ALTER TABLE production_occurrences
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE rehearsal_sessions
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE schedule_items
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';

UPDATE production_occurrences o
SET timezone = p.timezone
FROM productions p
WHERE p.workspace_id = o.workspace_id AND p.id = o.production_id;
UPDATE rehearsal_sessions r
SET timezone = p.timezone
FROM productions p
WHERE p.workspace_id = r.workspace_id AND p.id = r.production_id;
UPDATE schedule_items s
SET timezone = p.timezone
FROM productions p
WHERE p.workspace_id = s.workspace_id AND p.id = s.production_id;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 20}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
