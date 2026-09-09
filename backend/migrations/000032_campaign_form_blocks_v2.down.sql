DELETE FROM campaign_template_versions
WHERE version = 2
  AND template_id IN (
    'system_program_submission',
    'system_crew_recruitment',
    'system_event_registration',
    'system_general_collection'
  );

UPDATE campaign_templates
SET latest_version = 1,
    updated_at = NOW()
WHERE scope = 'system'
  AND id IN (
    'system_program_submission',
    'system_crew_recruitment',
    'system_event_registration',
    'system_general_collection'
  );

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":31}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
