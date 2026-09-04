-- System templates are global definitions; instances remain isolated per Workspace.
CREATE TABLE program_type_templates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sort_order)
);

INSERT INTO program_type_templates (key, name, color, sort_order)
VALUES
    ('music', '音乐', '#2563eb', 0),
    ('dance', '舞蹈', '#db2777', 1),
    ('theater', '戏剧', '#7c3aed', 2),
    ('language', '语言', '#d97706', 3),
    ('other', '其他', '#64748b', 4);

ALTER TABLE program_types
    ADD COLUMN system_key TEXT REFERENCES program_type_templates(key),
    ADD COLUMN is_system_default BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX program_types_workspace_system_key_unique
    ON program_types (workspace_id, system_key)
    WHERE deleted_at IS NULL AND system_key IS NOT NULL;

-- Existing tenants already have the five seeded rows. Match only the exact
-- original names so custom types are never silently promoted to system rows.
UPDATE program_types p
SET system_key = t.key,
    is_system_default = TRUE,
    updated_at = NOW()
FROM program_type_templates t
WHERE p.name = t.name
  AND p.deleted_at IS NULL;

CREATE TABLE file_type_templates (
    key TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN (
        'workspace', 'membership', 'person', 'organization', 'venue',
        'venue_space', 'equipment', 'program', 'production', 'file_library'
    )),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (scope, key)
);

INSERT INTO file_type_templates (key, scope, name, description, sort_order)
VALUES
    ('workspace.branding', 'workspace', '品牌标识', '工作空间头像、Logo 和品牌视觉资产。', 0),
    ('workspace.policies', 'workspace', '规章制度', '工作空间制度、流程和管理规范。', 1),
    ('workspace.agreements', 'workspace', '合作协议', '工作空间层面的合作、授权和协议文件。', 2),
    ('workspace.public_promotion', 'workspace', '公共宣传素材', '工作空间公共使用的宣传图片、海报和文案。', 3),
    ('workspace.uncategorized', 'workspace', '未分类', '暂未归入其他文件类型的工作空间文件。', 4),

    ('membership.photo', 'membership', '证件照', '工作空间成员使用的头像、证件照和身份照片。', 0),
    ('membership.identity_document', 'membership', '身份证明', '成员身份证明和实名材料。', 1),
    ('membership.agreements', 'membership', '合同与协议', '成员合同、协议和确认文件。', 2),
    ('membership.qualifications', 'membership', '资质证明', '成员资格、培训和专业资质材料。', 3),
    ('membership.health_insurance', 'membership', '保险与健康材料', '成员保险、健康和安全相关材料。', 4),
    ('membership.uncategorized', 'membership', '未分类', '暂未归入其他文件类型的成员文件。', 5),

    ('person.photo', 'person', '头像与证件照', '人员库联系人使用的头像、证件照和身份照片。', 0),
    ('person.identity_document', 'person', '身份证明', '人员库联系人的身份证明材料。', 1),
    ('person.resume', 'person', '履历与资历', '简历、履历、作品经历和专业资历。', 2),
    ('person.agreements', 'person', '合同与协议', '人员库联系人的合同、协议和授权文件。', 3),
    ('person.portfolio', 'person', '演出与作品资料', '演出记录、作品集和相关媒体资料。', 4),
    ('person.uncategorized', 'person', '未分类', '暂未归入其他文件类型的人员库文件。', 5),

    ('organization.branding', 'organization', 'Logo 与品牌标识', '机构 Logo、品牌规范和视觉识别资产。', 0),
    ('organization.qualifications', 'organization', '资质证明', '机构资质、登记和认证材料。', 1),
    ('organization.agreements', 'organization', '合作协议', '机构合作、授权和协议文件。', 2),
    ('organization.promotion', 'organization', '宣传素材', '机构介绍、宣传图片和推广素材。', 3),
    ('organization.profile', 'organization', '机构资料', '机构介绍、联系方式和其他基础资料。', 4),
    ('organization.uncategorized', 'organization', '未分类', '暂未归入其他文件类型的机构文件。', 5),

    ('venue.photos', 'venue', '场地照片', '场地环境、入口和设施照片。', 0),
    ('venue.layout', 'venue', '平面图与布局图', '场地平面图、布局图和区域示意图。', 1),
    ('venue.technical', 'venue', '技术资料', '场地技术条件、设备清单和技术说明。', 2),
    ('venue.agreements', 'venue', '合同与协议', '场地租赁、使用和合作协议。', 3),
    ('venue.safety', 'venue', '安全与消防资料', '场地安全、消防和应急相关资料。', 4),
    ('venue.promotion', 'venue', '宣传素材', '场地介绍和宣传使用的图片、视频及文案。', 5),
    ('venue.uncategorized', 'venue', '未分类', '暂未归入其他文件类型的场地文件。', 6),

    ('venue_space.layout', 'venue_space', '平面图与布局图', '场地空间的平面图、布局图和区域示意图。', 0),
    ('venue_space.stage_seating', 'venue_space', '舞台与座位图', '舞台、观众区和座位布局资料。', 1),
    ('venue_space.technical', 'venue_space', '技术资料', '空间技术条件、设备和接口资料。', 2),
    ('venue_space.safety', 'venue_space', '安全与消防资料', '空间安全、消防和应急相关资料。', 3),
    ('venue_space.media', 'venue_space', '照片与视频', '空间照片、视频和现场记录。', 4),
    ('venue_space.uncategorized', 'venue_space', '未分类', '暂未归入其他文件类型的场地空间文件。', 5),

    ('equipment.photos', 'equipment', '设备照片', '设备外观、安装和库存照片。', 0),
    ('equipment.branding', 'equipment', '品牌标识', '设备品牌 Logo 和识别资料。', 1),
    ('equipment.manual', 'equipment', '说明书与技术资料', '设备说明书、规格书和技术资料。', 2),
    ('equipment.maintenance', 'equipment', '质检与维修记录', '设备质检、保养、维修和故障记录。', 3),
    ('equipment.purchase_rental', 'equipment', '采购与租赁凭证', '设备采购、租赁、发票和交付凭证。', 4),
    ('equipment.uncategorized', 'equipment', '未分类', '暂未归入其他文件类型的设备文件。', 5),

    ('program.poster', 'program', '海报与宣传图', '节目海报、宣传图和推广视觉素材。', 0),
    ('program.audio', 'program', '音频', '节目音乐、音频底和其他声音素材。', 1),
    ('program.video', 'program', '视频', '节目视频、演示视频和影像素材。', 2),
    ('program.text', 'program', '歌词与文本', '歌词、台词、稿件和文字资料。', 3),
    ('program.technical', 'program', '技术需求与舞台资料', '节目技术需求、舞台图和执行资料。', 4),
    ('program.subtitle', 'program', '字幕与演出素材', '字幕、投影和演出播放素材。', 5),
    ('program.rights', 'program', '授权与版权资料', '节目授权、版权和使用许可文件。', 6),
    ('program.uncategorized', 'program', '未分类', '暂未归入其他文件类型的节目库文件。', 7),

    ('production.branding', 'production', '活动 Logo 与主视觉', '本场活动 Logo、主视觉和品牌素材。', 0),
    ('production.documents', 'production', '活动文档', '本场活动的计划、说明和执行文档。', 1),
    ('production.program_flow', 'production', '节目单与流程资料', '节目单、流程表和演出顺序资料。', 2),
    ('production.venue_stage', 'production', '场地与舞台资料', '本场活动使用的场地、舞台和技术图纸。', 3),
    ('production.agreements', 'production', '合同与协议', '本场活动相关的合同、协议和授权文件。', 4),
    ('production.promotion', 'production', '宣传素材', '本场活动的海报、宣传图片、视频和文案。', 5),
    ('production.live_media', 'production', '演出与现场素材', '演出记录、现场照片、视频和音频。', 6),
    ('production.uncategorized', 'production', '未分类', '暂未归入其他文件类型的活动文件。', 7),

    ('file_library.legal', 'file_library', '合同与法务', '文件资料库中的合同、法务和授权文件。', 0),
    ('file_library.finance', 'file_library', '财务与票据', '财务、发票、收据和结算资料。', 1),
    ('file_library.administration', 'file_library', '行政与制度', '行政通知、制度和管理资料。', 2),
    ('file_library.project', 'file_library', '项目资料', '跨资源复用的项目计划和工作资料。', 3),
    ('file_library.meetings', 'file_library', '会议与沟通记录', '会议纪要、沟通记录和决策资料。', 4),
    ('file_library.design', 'file_library', '图片与设计素材', '图片、设计源文件和视觉素材。', 5),
    ('file_library.audio_video', 'file_library', '音视频', '独立归档的音频、视频和媒体资料。', 6),
    ('file_library.uncategorized', 'file_library', '未分类', '暂未归入其他文件类型的资料库文件。', 7);

CREATE TABLE file_types (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN (
        'workspace', 'membership', 'person', 'organization', 'venue',
        'venue_space', 'equipment', 'program', 'production', 'file_library'
    )),
    template_key TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_system_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (scope, template_key) REFERENCES file_type_templates(scope, key) ON DELETE RESTRICT,
    CHECK (template_key IS NOT NULL OR is_system_default = FALSE)
);

CREATE UNIQUE INDEX file_types_workspace_scope_name_unique
    ON file_types (workspace_id, scope, LOWER(name))
    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX file_types_workspace_template_unique
    ON file_types (workspace_id, scope, template_key)
    WHERE deleted_at IS NULL AND template_key IS NOT NULL;
CREATE INDEX file_types_workspace_scope_order_idx
    ON file_types (workspace_id, scope, is_active, sort_order)
    WHERE deleted_at IS NULL;

-- Backfill every existing tenant. The deterministic id makes this operation
-- safe to re-run while the NOT EXISTS guard handles partially applied data.
INSERT INTO file_types (
    id, workspace_id, scope, template_key, name, description, sort_order,
    is_system_default, is_active, created_by
)
SELECT md5(w.id || ':' || t.key),
       w.id, t.scope, t.key, t.name, t.description, t.sort_order,
       TRUE, t.is_active, owner.user_id
FROM workspaces w
JOIN LATERAL (
    SELECT m.user_id
    FROM workspace_memberships m
    WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
    ORDER BY m.created_at, m.id
    LIMIT 1
) owner ON TRUE
CROSS JOIN file_type_templates t
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM file_types f
      WHERE f.workspace_id = w.id AND f.scope = t.scope AND f.template_key = t.key
  );

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 8}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
