-- Deterministic system templates used by the Campaign intake UI.
-- Definitions are immutable snapshots copied into Campaign FormVersions.

INSERT INTO campaign_templates (
    id, scope, kind, name, description, status, latest_version, created_by
) VALUES
    ('system_program_submission', 'system', 'SUBMISSION', '节目征集', '节目名称、演出者、时长、附件和舞台需求。', 'published', 1, NULL),
    ('system_crew_recruitment', 'system', 'RECRUITMENT', '工作人员招募', '岗位偏好、可用时间、技能和联系方式。', 'published', 1, NULL),
    ('system_event_registration', 'system', 'REGISTRATION', '普通活动报名', '参与者信息、名额、审核和候补名单。', 'published', 1, NULL),
    ('system_general_collection', 'system', 'COLLECTION', '通用信息收集', '从空白字段开始，适用于资料、需求和反馈收集。', 'published', 1, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaign_template_versions (id, template_id, workspace_id, version, definition, created_by)
VALUES
    (
        'system_program_submission_v1', 'system_program_submission', NULL, 1,
        '{
          "form": {
            "schema_version": 1,
            "blocks": [{"id":"basic","type":"section","title":"节目资料"},{"id":"technical","type":"section","title":"技术资料"}],
            "fields": [
              {"id":"program_title","type":"text","label":"节目名称","required":true,"semantic_key":"PROGRAM_TITLE"},
              {"id":"program_type","type":"text","label":"节目类型","required":true,"semantic_key":"PROGRAM_TYPE"},
              {"id":"performers","type":"text","label":"演出者","required":true,"semantic_key":"PROGRAM_PARTICIPANTS"},
              {"id":"duration_seconds","type":"number","label":"预计时长（秒）","required":true,"semantic_key":"PROGRAM_DURATION"},
              {"id":"description","type":"textarea","label":"节目介绍"},
              {"id":"demo","type":"file","label":"Demo","required":true,"semantic_key":"PROGRAM_AUDIO"},
              {"id":"technical_notes","type":"textarea","label":"舞台与技术需求","semantic_key":"TECH_REQUIREMENTS"}
            ],
            "logic_rules": [],
            "end_screen": {}
          },
          "availability_policy": {},
          "review_workflow": {"stages":[{"key":"qualification","name":"资格检查"},{"key":"content","name":"内容评分"}]},
          "materialization_plan": {"target_kind":"production_program"},
          "metadata": {"tags":["多阶段审核","附件"]}
        }'::jsonb, NULL
    ),
    (
        'system_crew_recruitment_v1', 'system_crew_recruitment', NULL, 1,
        '{
          "form": {
            "schema_version": 1,
            "blocks": [{"id":"contact","type":"section","title":"联系信息"},{"id":"role","type":"section","title":"岗位信息"}],
            "fields": [
              {"id":"display_name","type":"text","label":"姓名","required":true,"semantic_key":"PERSON_NAME"},
              {"id":"contact","type":"text","label":"联系方式","required":true,"semantic_key":"PERSON_CONTACT"},
              {"id":"roles","type":"multiselect","label":"岗位偏好","required":true,"semantic_key":"PERSON_ROLES"},
              {"id":"availability","type":"textarea","label":"可用时间"},
              {"id":"skills","type":"textarea","label":"技能与经验"}
            ],
            "logic_rules": [],
            "end_screen": {}
          },
          "availability_policy": {},
          "review_workflow": {"stages":[{"key":"screening","name":"资格筛选"}]},
          "materialization_plan": {"target_kind":"production_person"},
          "metadata": {"tags":["岗位","候补"]}
        }'::jsonb, NULL
    ),
    (
        'system_event_registration_v1', 'system_event_registration', NULL, 1,
        '{
          "form": {
            "schema_version": 1,
            "blocks": [{"id":"participant","type":"section","title":"参与者信息"}],
            "fields": [
              {"id":"display_name","type":"text","label":"姓名或团队名称","required":true,"semantic_key":"SUBJECT_NAME"},
              {"id":"email","type":"email","label":"邮箱","required":true,"semantic_key":"CONTACT_EMAIL"},
              {"id":"participant_count","type":"number","label":"参与人数","required":true,"semantic_key":"PARTICIPANT_COUNT"}
            ],
            "logic_rules": [],
            "end_screen": {}
          },
          "availability_policy": {"capacity": 0},
          "review_workflow": {},
          "materialization_plan": {"target_kind":"production_registration"},
          "metadata": {"tags":["名额","候补"]}
        }'::jsonb, NULL
    ),
    (
        'system_general_collection_v1', 'system_general_collection', NULL, 1,
        '{
          "form": {
            "schema_version": 1,
            "blocks": [],
            "fields": [],
            "logic_rules": [],
            "end_screen": {}
          },
          "availability_policy": {},
          "review_workflow": {},
          "materialization_plan": {"target_kind":"form_response"},
          "metadata": {"tags":["自由字段"]}
        }'::jsonb, NULL
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 29}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
