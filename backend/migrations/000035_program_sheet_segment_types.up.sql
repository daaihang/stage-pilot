CREATE TABLE program_sheet_segment_type_templates (
    system_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '自定义',
    color TEXT NOT NULL DEFAULT '#64748b',
    default_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (default_duration_seconds >= 0),
    counts_toward_duration BOOLEAN NOT NULL DEFAULT TRUE,
    audience_visible BOOLEAN NOT NULL DEFAULT TRUE,
    requires_execution BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE program_sheet_segment_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    system_key TEXT REFERENCES program_sheet_segment_type_templates(system_key) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    category TEXT NOT NULL DEFAULT '自定义',
    color TEXT NOT NULL DEFAULT '#64748b',
    default_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (default_duration_seconds >= 0),
    counts_toward_duration BOOLEAN NOT NULL DEFAULT TRUE,
    audience_visible BOOLEAN NOT NULL DEFAULT TRUE,
    requires_execution BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX program_sheet_segment_types_name_uq ON program_sheet_segment_types (workspace_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX program_sheet_segment_types_system_uq ON program_sheet_segment_types (workspace_id, system_key) WHERE system_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX program_sheet_segment_types_list_idx ON program_sheet_segment_types (workspace_id, deleted_at, sort_order, id);

INSERT INTO program_sheet_segment_type_templates (system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,sort_order) VALUES
('opening','开场','演出','#2563eb',300,true,true,true,0),
('host','主持','演出','#7c3aed',180,true,true,true,1),
('speech','致辞/发言','演出','#9333ea',300,true,true,true,2),
('ceremony','仪式','演出','#c026d3',300,true,true,true,3),
('award','颁奖','演出','#db2777',300,true,true,true,4),
('announcement','公告','演出','#ea580c',120,true,true,true,5),
('sponsor','赞助商环节','演出','#ca8a04',180,true,true,true,6),
('video','视频','媒体','#0891b2',300,true,true,true,7),
('audio','音频/播报','媒体','#0284c7',180,true,true,true,8),
('interaction','互动','演出','#059669',600,true,true,true,9),
('photo','合影','演出','#16a34a',300,true,true,true,10),
('transition','转场','制作','#65a30d',120,false,false,true,11),
('technical','技术环节','制作','#4f46e5',300,false,false,true,12),
('doors','开门','制作','#64748b',600,true,true,true,13),
('closing','结束','演出','#475569',180,true,true,true,14),
('other','其他','其他','#6b7280',0,false,false,false,15)
ON CONFLICT (system_key) DO NOTHING;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":35}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

ALTER TABLE program_sheet_releases ADD COLUMN IF NOT EXISTS retracted_at TIMESTAMPTZ;
ALTER TABLE program_sheet_releases ADD COLUMN IF NOT EXISTS retracted_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE program_sheet_releases ADD COLUMN IF NOT EXISTS retract_note TEXT NOT NULL DEFAULT '';
