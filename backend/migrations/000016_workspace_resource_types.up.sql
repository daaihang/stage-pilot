-- Extend the workspace type model to people, organizations, and equipment.
-- New APIs use only *_type_id. Legacy kind/category values are backfilled and
-- then removed in this intentionally breaking migration.

CREATE TABLE person_type_templates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO person_type_templates (key,name,color,sort_order) VALUES
    ('artist','演出者','#2563eb',0),('speaker_host','嘉宾 / 主持','#7c3aed',1),
    ('creative','创作与内容','#db2777',2),('crew','工作人员','#0f766e',3),
    ('operations','运营与现场服务','#16a34a',4),('management','制作管理','#d97706',5),
    ('volunteer','志愿者','#65a30d',6),('guest','嘉宾 / 贵宾','#9333ea',7),
    ('contact','联系人','#0891b2',8),('other','其他','#64748b',9);

CREATE TABLE organization_type_templates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO organization_type_templates (key,name,color,sort_order) VALUES
    ('organizer','主办方','#2563eb',0),('execution_agency','承办 / 执行方','#7c3aed',1),
    ('co_organizer','协办方','#9333ea',2),('brand_client','品牌 / 客户','#db2777',3),
    ('partner','合作方','#0f766e',4),('sponsor','赞助方','#d97706',5),
    ('supplier','供应商','#64748b',6),('venue_operator','场地方','#0891b2',7),
    ('artist_agency','艺人经纪','#7c3aed',8),('ensemble','演出团体','#db2777',9),
    ('production_service','制作服务','#16a34a',10),('equipment_rental','设备租赁','#65a30d',11),
    ('marketing_agency','营销 / 公关','#9333ea',12),('media','媒体 / 宣传','#2563eb',13),
    ('ticketing','票务 / 平台','#0891b2',14),('school','学校 / 教育机构','#d97706',15),
    ('government','政府 / 公共机构','#0f766e',16),('nonprofit','社会组织 / 公益','#16a34a',17),
    ('hospitality','住宿 / 餐饮','#db2777',18),('transport','交通 / 物流','#64748b',19),
    ('security_medical','安保 / 医疗','#dc2626',20),('other','其他','#475569',21);

CREATE TABLE equipment_type_templates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO equipment_type_templates (key,name,color,sort_order) VALUES
    ('audio','音频','#2563eb',0),('lighting','灯光','#d97706',1),
    ('video','视频与显示','#7c3aed',2),('camera','摄影与直播','#db2777',3),
    ('stage','舞台','#0f766e',4),('rigging','桁架与吊挂','#16a34a',5),
    ('backline','乐器与背线','#9333ea',6),('power','电力与配电','#dc2626',7),
    ('communications','通信与对讲','#0891b2',8),('networking_it','网络与 IT','#2563eb',9),
    ('cable_accessories','线缆与配件','#64748b',10),('scenic','美术与布景','#d97706',11),
    ('furniture','家具与观众设施','#65a30d',12),('safety','安全与应急','#dc2626',13),
    ('transport_cases','运输与机柜','#475569',14),('consumables','耗材','#db2777',15),
    ('other','其他','#64748b',16);

CREATE TABLE person_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    system_key TEXT REFERENCES person_type_templates(key),
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
CREATE UNIQUE INDEX person_types_workspace_name_unique ON person_types(workspace_id,LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX person_types_workspace_system_unique ON person_types(workspace_id,system_key) WHERE deleted_at IS NULL AND system_key IS NOT NULL;
CREATE INDEX person_types_workspace_order_idx ON person_types(workspace_id,is_active,sort_order) WHERE deleted_at IS NULL;

CREATE TABLE organization_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    system_key TEXT REFERENCES organization_type_templates(key),
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
CREATE UNIQUE INDEX organization_types_workspace_name_unique ON organization_types(workspace_id,LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX organization_types_workspace_system_unique ON organization_types(workspace_id,system_key) WHERE deleted_at IS NULL AND system_key IS NOT NULL;
CREATE INDEX organization_types_workspace_order_idx ON organization_types(workspace_id,is_active,sort_order) WHERE deleted_at IS NULL;

CREATE TABLE equipment_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    system_key TEXT REFERENCES equipment_type_templates(key),
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
CREATE UNIQUE INDEX equipment_types_workspace_name_unique ON equipment_types(workspace_id,LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX equipment_types_workspace_system_unique ON equipment_types(workspace_id,system_key) WHERE deleted_at IS NULL AND system_key IS NOT NULL;
CREATE INDEX equipment_types_workspace_order_idx ON equipment_types(workspace_id,is_active,sort_order) WHERE deleted_at IS NULL;

ALTER TABLE people ADD COLUMN person_type_id TEXT;
ALTER TABLE organizations ADD COLUMN organization_type_id TEXT;
ALTER TABLE equipment_items ADD COLUMN equipment_type_id TEXT;
ALTER TABLE people ADD CONSTRAINT people_workspace_person_type_fk FOREIGN KEY (workspace_id,person_type_id) REFERENCES person_types(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE organizations ADD CONSTRAINT organizations_workspace_organization_type_fk FOREIGN KEY (workspace_id,organization_type_id) REFERENCES organization_types(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE equipment_items ADD CONSTRAINT equipment_items_workspace_equipment_type_fk FOREIGN KEY (workspace_id,equipment_type_id) REFERENCES equipment_types(workspace_id,id) ON DELETE RESTRICT;

-- Only an active Workspace Owner is a valid audit actor for historical seed
-- rows. Anomalous workspaces without an owner are intentionally skipped so a
-- migration never attributes defaults to a different member or resource.
WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id
        FROM workspace_memberships m
        WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active'
        ORDER BY m.created_at,m.id
        LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO person_types (id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_by)
SELECT md5(a.workspace_id || ':' || t.key),a.workspace_id,t.key,t.name,t.color,t.sort_order,TRUE,t.is_active,a.created_by
FROM workspace_actors a CROSS JOIN person_type_templates t
WHERE a.created_by IS NOT NULL;

WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id
        FROM workspace_memberships m
        WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active'
        ORDER BY m.created_at,m.id
        LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO organization_types (id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_by)
SELECT md5(a.workspace_id || ':' || t.key),a.workspace_id,t.key,t.name,t.color,t.sort_order,TRUE,t.is_active,a.created_by
FROM workspace_actors a CROSS JOIN organization_type_templates t
WHERE a.created_by IS NOT NULL;

WITH workspace_actors AS (
    SELECT w.id AS workspace_id, owner.user_id AS created_by
    FROM workspaces w
    JOIN LATERAL (
        SELECT m.user_id
        FROM workspace_memberships m
        WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active'
        ORDER BY m.created_at,m.id
        LIMIT 1
    ) owner ON TRUE
    WHERE w.deleted_at IS NULL
)
INSERT INTO equipment_types (id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_by)
SELECT md5(a.workspace_id || ':' || t.key),a.workspace_id,t.key,t.name,t.color,t.sort_order,TRUE,t.is_active,a.created_by
FROM workspace_actors a CROSS JOIN equipment_type_templates t
WHERE a.created_by IS NOT NULL;

DO $$
DECLARE
    skipped_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO skipped_count
    FROM workspaces w
    WHERE w.deleted_at IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM workspace_memberships m
          WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active'
      );
    IF skipped_count > 0 THEN
        RAISE NOTICE 'workspace_resource_types: skipped % workspace(s) without an active Workspace Owner', skipped_count;
    END IF;
END $$;

UPDATE people p SET person_type_id=t.id,updated_at=NOW()
FROM person_types t WHERE t.workspace_id=p.workspace_id AND t.system_key=p.kind AND t.deleted_at IS NULL;
UPDATE organizations o SET organization_type_id=t.id,updated_at=NOW()
FROM organization_types t WHERE t.workspace_id=o.workspace_id AND t.system_key=o.kind AND t.deleted_at IS NULL;
UPDATE equipment_items e SET equipment_type_id=t.id,updated_at=NOW()
FROM equipment_types t WHERE t.workspace_id=e.workspace_id AND t.system_key=e.category AND t.deleted_at IS NULL;
UPDATE venues v SET venue_type_id=t.id,updated_at=NOW()
FROM venue_types t WHERE t.workspace_id=v.workspace_id AND t.system_key=CASE v.kind WHEN 'hall' THEN 'auditorium' ELSE v.kind END AND t.deleted_at IS NULL AND v.venue_type_id IS NULL;

DROP INDEX IF EXISTS people_workspace_kind_status_idx;
DROP INDEX IF EXISTS organizations_workspace_kind_status_idx;
DROP INDEX IF EXISTS venues_workspace_kind_status_idx;
DROP INDEX IF EXISTS equipment_items_workspace_category_status_idx;
-- A previous interrupted attempt may have created the replacement venue
-- index before the migration was marked dirty. Remove it before recreating so
-- forcing the migration back to v15 and retrying remains safe.
DROP INDEX IF EXISTS venues_workspace_type_status_idx;
ALTER TABLE people DROP COLUMN kind;
ALTER TABLE organizations DROP COLUMN kind;
ALTER TABLE venues DROP COLUMN kind;
ALTER TABLE equipment_items DROP COLUMN category;
CREATE INDEX people_workspace_type_status_idx ON people(workspace_id,person_type_id,status) WHERE deleted_at IS NULL;
CREATE INDEX organizations_workspace_type_status_idx ON organizations(workspace_id,organization_type_id,status) WHERE deleted_at IS NULL;
CREATE INDEX venues_workspace_type_status_idx ON venues(workspace_id,venue_type_id,status) WHERE deleted_at IS NULL;
CREATE INDEX equipment_items_workspace_type_status_idx ON equipment_items(workspace_id,equipment_type_id,status,ownership) WHERE deleted_at IS NULL;

INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":16}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
