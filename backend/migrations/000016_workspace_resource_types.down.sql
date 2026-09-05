-- Restore the legacy classification columns. Custom and unclassified values
-- degrade to the legacy fallback because pre-v16 schemas cannot represent them.

ALTER TABLE people ADD COLUMN kind TEXT;
ALTER TABLE organizations ADD COLUMN kind TEXT;
ALTER TABLE venues ADD COLUMN kind TEXT;
ALTER TABLE equipment_items ADD COLUMN category TEXT;

UPDATE people p SET kind=COALESCE((SELECT CASE t.system_key
    WHEN 'artist' THEN 'artist' WHEN 'crew' THEN 'crew' ELSE 'contact' END
    FROM person_types t WHERE t.id=p.person_type_id AND t.workspace_id=p.workspace_id), 'contact');
UPDATE organizations o SET kind=COALESCE((SELECT CASE t.system_key
    WHEN 'organizer' THEN 'organizer' WHEN 'partner' THEN 'partner' WHEN 'sponsor' THEN 'sponsor'
    WHEN 'supplier' THEN 'supplier' WHEN 'school' THEN 'school' WHEN 'ensemble' THEN 'ensemble' ELSE 'other' END
    FROM organization_types t WHERE t.id=o.organization_type_id AND t.workspace_id=o.workspace_id), 'other');
UPDATE venues v SET kind=COALESCE((SELECT CASE t.system_key
    WHEN 'theatre' THEN 'theatre' WHEN 'auditorium' THEN 'hall' WHEN 'club' THEN 'club' WHEN 'outdoor' THEN 'outdoor' ELSE 'other' END
    FROM venue_types t WHERE t.id=v.venue_type_id AND t.workspace_id=v.workspace_id), 'other');
UPDATE equipment_items e SET category=COALESCE((SELECT CASE t.system_key
    WHEN 'audio' THEN 'audio' WHEN 'lighting' THEN 'lighting' WHEN 'video' THEN 'video'
    WHEN 'stage' THEN 'stage' WHEN 'power' THEN 'power' ELSE 'other' END
    FROM equipment_types t WHERE t.id=e.equipment_type_id AND t.workspace_id=e.workspace_id), 'other');

ALTER TABLE people ALTER COLUMN kind SET NOT NULL;
ALTER TABLE organizations ALTER COLUMN kind SET NOT NULL;
ALTER TABLE venues ALTER COLUMN kind SET NOT NULL;
ALTER TABLE equipment_items ALTER COLUMN category SET NOT NULL;
ALTER TABLE people ADD CONSTRAINT people_kind_check CHECK (kind IN ('artist','crew','contact'));
ALTER TABLE organizations ADD CONSTRAINT organizations_kind_check CHECK (kind IN ('organizer','partner','sponsor','supplier','school','ensemble','other'));
ALTER TABLE venues ADD CONSTRAINT venues_kind_check CHECK (kind IN ('theatre','hall','club','outdoor','other'));
ALTER TABLE equipment_items ADD CONSTRAINT equipment_items_category_check CHECK (category IN ('audio','lighting','video','stage','power','other'));
CREATE INDEX people_workspace_kind_status_idx ON people(workspace_id,kind,status) WHERE deleted_at IS NULL;
CREATE INDEX organizations_workspace_kind_status_idx ON organizations(workspace_id,kind,status) WHERE deleted_at IS NULL;
CREATE INDEX venues_workspace_kind_status_idx ON venues(workspace_id,kind,status) WHERE deleted_at IS NULL;
CREATE INDEX equipment_items_workspace_category_status_idx ON equipment_items(workspace_id,category,status,ownership) WHERE deleted_at IS NULL;

ALTER TABLE people DROP CONSTRAINT people_workspace_person_type_fk;
ALTER TABLE organizations DROP CONSTRAINT organizations_workspace_organization_type_fk;
ALTER TABLE equipment_items DROP CONSTRAINT equipment_items_workspace_equipment_type_fk;
ALTER TABLE people DROP COLUMN person_type_id;
ALTER TABLE organizations DROP COLUMN organization_type_id;
ALTER TABLE equipment_items DROP COLUMN equipment_type_id;

DROP TABLE equipment_types;
DROP TABLE organization_types;
DROP TABLE person_types;
DROP TABLE equipment_type_templates;
DROP TABLE organization_type_templates;
DROP TABLE person_type_templates;

INSERT INTO app_metadata (key,value) VALUES ('schema','{"version":15}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW();
