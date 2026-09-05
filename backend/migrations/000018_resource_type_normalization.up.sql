-- Resource libraries always use a concrete workspace type.  “other” is the
-- canonical fallback; NULL is no longer a resource classification state.
DO $$
DECLARE
    missing_workspaces TEXT;
BEGIN
    SELECT string_agg(w.id, ', ' ORDER BY w.id)
    INTO missing_workspaces
    FROM workspaces w
    WHERE w.deleted_at IS NULL
      AND (EXISTS (SELECT 1 FROM programs r WHERE r.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM venues r WHERE r.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM people r WHERE r.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM organizations r WHERE r.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM equipment_items r WHERE r.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM program_types t WHERE t.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM venue_types t WHERE t.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM person_types t WHERE t.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM organization_types t WHERE t.workspace_id = w.id)
        OR EXISTS (SELECT 1 FROM equipment_types t WHERE t.workspace_id = w.id))
      AND NOT EXISTS (
          SELECT 1
          FROM workspace_memberships m
          WHERE m.workspace_id = w.id
            AND m.role = 'owner'
            AND m.status = 'active'
      );

    IF missing_workspaces IS NOT NULL THEN
        RAISE EXCEPTION 'cannot normalize resource types: active Workspace Owner missing for %', missing_workspaces;
    END IF;
END $$;

DO $$
DECLARE
    skipped_workspaces TEXT;
BEGIN
    SELECT string_agg(w.id, ', ' ORDER BY w.id)
    INTO skipped_workspaces
    FROM workspaces w
    WHERE w.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM programs r WHERE r.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM venues r WHERE r.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM people r WHERE r.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM organizations r WHERE r.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM equipment_items r WHERE r.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM program_types t WHERE t.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM venue_types t WHERE t.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM person_types t WHERE t.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM organization_types t WHERE t.workspace_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM equipment_types t WHERE t.workspace_id = w.id);
    IF skipped_workspaces IS NOT NULL THEN
        RAISE NOTICE 'resource_type_normalization: skipped empty workspaces without an owner: %', skipped_workspaces;
    END IF;
END $$;

-- Historical handlers could soft-delete the fallback row. Restore that same
-- stable system row before filling any missing rows, so the deterministic ID
-- below never collides with a soft-deleted predecessor.
UPDATE program_types SET deleted_at = NULL, updated_at = NOW() WHERE system_key = 'other' AND deleted_at IS NOT NULL;
UPDATE venue_types SET deleted_at = NULL, updated_at = NOW() WHERE system_key = 'other' AND deleted_at IS NOT NULL;
UPDATE person_types SET deleted_at = NULL, updated_at = NOW() WHERE system_key = 'other' AND deleted_at IS NOT NULL;
UPDATE organization_types SET deleted_at = NULL, updated_at = NOW() WHERE system_key = 'other' AND deleted_at IS NOT NULL;
UPDATE equipment_types SET deleted_at = NULL, updated_at = NOW() WHERE system_key = 'other' AND deleted_at IS NOT NULL;

WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id
        FROM workspace_memberships m
        WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
        ORDER BY m.created_at, m.id
        LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO program_types (id, workspace_id, system_key, name, color, sort_order, is_system_default, is_active, created_by)
SELECT md5(a.workspace_id || ':other'), a.workspace_id, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, a.created_by
FROM workspace_actors a
JOIN program_type_templates t ON t.key = 'other'
WHERE NOT EXISTS (
    SELECT 1 FROM program_types existing
    WHERE existing.workspace_id = a.workspace_id AND existing.system_key = 'other' AND existing.deleted_at IS NULL
);

WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id FROM workspace_memberships m
        WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
        ORDER BY m.created_at, m.id LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO venue_types (id, workspace_id, system_key, name, color, sort_order, is_system_default, is_active, created_by)
SELECT md5(a.workspace_id || ':other'), a.workspace_id, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, a.created_by
FROM workspace_actors a
JOIN venue_type_templates t ON t.key = 'other'
WHERE NOT EXISTS (
    SELECT 1 FROM venue_types existing
    WHERE existing.workspace_id = a.workspace_id AND existing.system_key = 'other' AND existing.deleted_at IS NULL
);

WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id FROM workspace_memberships m
        WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
        ORDER BY m.created_at, m.id LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO person_types (id, workspace_id, system_key, name, color, sort_order, is_system_default, is_active, created_by)
SELECT md5(a.workspace_id || ':other'), a.workspace_id, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, a.created_by
FROM workspace_actors a
JOIN person_type_templates t ON t.key = 'other'
WHERE NOT EXISTS (
    SELECT 1 FROM person_types existing
    WHERE existing.workspace_id = a.workspace_id AND existing.system_key = 'other' AND existing.deleted_at IS NULL
);

WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id FROM workspace_memberships m
        WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
        ORDER BY m.created_at, m.id LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO organization_types (id, workspace_id, system_key, name, color, sort_order, is_system_default, is_active, created_by)
SELECT md5(a.workspace_id || ':other'), a.workspace_id, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, a.created_by
FROM workspace_actors a
JOIN organization_type_templates t ON t.key = 'other'
WHERE NOT EXISTS (
    SELECT 1 FROM organization_types existing
    WHERE existing.workspace_id = a.workspace_id AND existing.system_key = 'other' AND existing.deleted_at IS NULL
);

WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id FROM workspace_memberships m
        WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
        ORDER BY m.created_at, m.id LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO equipment_types (id, workspace_id, system_key, name, color, sort_order, is_system_default, is_active, created_by)
SELECT md5(a.workspace_id || ':other'), a.workspace_id, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, a.created_by
FROM workspace_actors a
JOIN equipment_type_templates t ON t.key = 'other'
WHERE NOT EXISTS (
    SELECT 1 FROM equipment_types existing
    WHERE existing.workspace_id = a.workspace_id AND existing.system_key = 'other' AND existing.deleted_at IS NULL
);

UPDATE programs r SET program_type_id = t.id, updated_at = NOW()
FROM program_types t
WHERE r.workspace_id = t.workspace_id AND t.system_key = 'other' AND t.deleted_at IS NULL AND r.program_type_id IS NULL;

UPDATE venues r SET venue_type_id = t.id, updated_at = NOW()
FROM venue_types t
WHERE r.workspace_id = t.workspace_id AND t.system_key = 'other' AND t.deleted_at IS NULL AND r.venue_type_id IS NULL;

UPDATE people r SET person_type_id = t.id, updated_at = NOW()
FROM person_types t
WHERE r.workspace_id = t.workspace_id AND t.system_key = 'other' AND t.deleted_at IS NULL AND r.person_type_id IS NULL;

UPDATE organizations r SET organization_type_id = t.id, updated_at = NOW()
FROM organization_types t
WHERE r.workspace_id = t.workspace_id AND t.system_key = 'other' AND t.deleted_at IS NULL AND r.organization_type_id IS NULL;

UPDATE equipment_items r SET equipment_type_id = t.id, updated_at = NOW()
FROM equipment_types t
WHERE r.workspace_id = t.workspace_id AND t.system_key = 'other' AND t.deleted_at IS NULL AND r.equipment_type_id IS NULL;

ALTER TABLE programs ALTER COLUMN program_type_id SET NOT NULL;
ALTER TABLE venues ALTER COLUMN venue_type_id SET NOT NULL;
ALTER TABLE people ALTER COLUMN person_type_id SET NOT NULL;
ALTER TABLE organizations ALTER COLUMN organization_type_id SET NOT NULL;
ALTER TABLE equipment_items ALTER COLUMN equipment_type_id SET NOT NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 18}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
