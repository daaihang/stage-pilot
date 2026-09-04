-- Unified global templates -> workspace instances for resource classifications.
CREATE TABLE venue_type_templates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sort_order)
);
INSERT INTO venue_type_templates (key,name,color,sort_order) VALUES
 ('theatre','剧院','#7c3aed',0),('concert_hall','音乐厅','#2563eb',1),
 ('auditorium','礼堂','#0891b2',2),('conference','会议中心','#0f766e',3),
 ('exhibition','展馆','#d97706',4),('sports','体育馆','#16a34a',5),
 ('club','俱乐部','#db2777',6),('outdoor','户外场地','#65a30d',7),
 ('campus','校园场地','#9333ea',8),('other','其他','#64748b',9);

CREATE TABLE venue_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    system_key TEXT REFERENCES venue_type_templates(key),
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_system_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id,id),
    CHECK (system_key IS NOT NULL OR is_system_default = FALSE)
);
CREATE UNIQUE INDEX venue_types_workspace_name_unique ON venue_types(workspace_id,LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX venue_types_workspace_system_unique ON venue_types(workspace_id,system_key) WHERE deleted_at IS NULL AND system_key IS NOT NULL;
CREATE INDEX venue_types_workspace_order_idx ON venue_types(workspace_id,is_active,sort_order) WHERE deleted_at IS NULL;

ALTER TABLE venues ADD COLUMN venue_type_id TEXT;
ALTER TABLE venues ADD CONSTRAINT venues_workspace_venue_type_fk FOREIGN KEY (workspace_id,venue_type_id) REFERENCES venue_types(workspace_id,id) ON DELETE RESTRICT;

-- Backfill missing program defaults without changing existing rows.
INSERT INTO program_types (id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_by)
SELECT md5(w.id || ':' || t.key), w.id, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, owner.user_id
FROM workspaces w
JOIN LATERAL (SELECT m.user_id FROM workspace_memberships m WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active' ORDER BY m.created_at,m.id LIMIT 1) owner ON TRUE
CROSS JOIN program_type_templates t
WHERE w.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM program_types p WHERE p.workspace_id=w.id AND p.system_key=t.key AND p.deleted_at IS NULL);

INSERT INTO venue_types (id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_by)
SELECT md5(w.id || ':' || t.key), w.id, t.key, t.name, t.color, t.sort_order, TRUE, t.is_active, owner.user_id
FROM workspaces w
JOIN LATERAL (SELECT m.user_id FROM workspace_memberships m WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active' ORDER BY m.created_at,m.id LIMIT 1) owner ON TRUE
CROSS JOIN venue_type_templates t
WHERE w.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM venue_types v WHERE v.workspace_id=w.id AND v.system_key=t.key AND v.deleted_at IS NULL);

UPDATE venues v SET venue_type_id = vt.id, updated_at=NOW()
FROM venue_types vt
WHERE vt.workspace_id=v.workspace_id AND vt.system_key=CASE v.kind WHEN 'hall' THEN 'auditorium' ELSE v.kind END AND v.venue_type_id IS NULL;

INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":11}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
