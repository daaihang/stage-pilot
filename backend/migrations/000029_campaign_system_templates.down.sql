DELETE FROM campaign_template_versions
WHERE id IN (
    'system_program_submission_v1',
    'system_crew_recruitment_v1',
    'system_event_registration_v1',
    'system_general_collection_v1'
);
DELETE FROM campaign_templates
WHERE id IN (
    'system_program_submission',
    'system_crew_recruitment',
    'system_event_registration',
    'system_general_collection'
);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 28}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
