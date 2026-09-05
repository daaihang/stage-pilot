-- Keep resource-type ordering deterministic within each Workspace. The
-- “other” sentinel is always the last persisted item; all other types retain
-- their current relative order (with system rows winning ties from legacy
-- data).
DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['program_types','venue_types','person_types','organization_types','equipment_types'] LOOP
        EXECUTE format($sql$
            WITH ordered AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY workspace_id
                           ORDER BY CASE WHEN system_key = 'other' THEN 1 ELSE 0 END,
                                    sort_order,
                                    is_system_default DESC,
                                    id
                       ) - 1 AS next_order
                FROM %I
                WHERE deleted_at IS NULL
            )
            UPDATE %I t
            SET sort_order = ordered.next_order,
                updated_at = CASE WHEN t.sort_order IS DISTINCT FROM ordered.next_order THEN NOW() ELSE t.updated_at END
            FROM ordered
            WHERE t.id = ordered.id
        $sql$, table_name, table_name);
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS program_types_workspace_sort_order_unique
    ON program_types(workspace_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS venue_types_workspace_sort_order_unique
    ON venue_types(workspace_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS person_types_workspace_sort_order_unique
    ON person_types(workspace_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organization_types_workspace_sort_order_unique
    ON organization_types(workspace_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_types_workspace_sort_order_unique
    ON equipment_types(workspace_id, sort_order) WHERE deleted_at IS NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 19}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
