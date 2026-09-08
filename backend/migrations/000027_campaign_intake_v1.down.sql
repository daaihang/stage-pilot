ALTER TABLE resource_commitments DROP CONSTRAINT IF EXISTS resource_commitments_source_entry_fk;
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_source_entry_fk;
DROP INDEX IF EXISTS production_registrations_entry_unique;
ALTER TABLE production_registrations DROP CONSTRAINT IF EXISTS production_registrations_entry_fk;
ALTER TABLE production_registrations ALTER COLUMN entry_id DROP NOT NULL;
ALTER TABLE production_people DROP CONSTRAINT IF EXISTS production_people_source_entry_fk;
ALTER TABLE production_programs DROP CONSTRAINT IF EXISTS production_programs_source_entry_fk;
DROP INDEX IF EXISTS form_responses_campaign_idx;
DROP TABLE IF EXISTS form_responses;
DROP INDEX IF EXISTS entry_materializations_target_idx;
DROP INDEX IF EXISTS entry_materializations_entry_idx;
DROP TABLE IF EXISTS entry_materializations;
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_current_decision_fk;
DROP INDEX IF EXISTS decisions_entry_history_idx;
DROP INDEX IF EXISTS decisions_current_unique;
DROP TABLE IF EXISTS decisions;
DROP INDEX IF EXISTS entry_revisions_entry_idx;
DROP TABLE IF EXISTS entry_revisions;
DROP INDEX IF EXISTS entries_production_status_idx;
DROP INDEX IF EXISTS entries_campaign_inbox_idx;
DROP INDEX IF EXISTS entries_access_token_hash_unique;
DROP TABLE IF EXISTS entries;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_published_revision_fk;
DROP INDEX IF EXISTS campaign_revisions_campaign_idx;
DROP INDEX IF EXISTS campaign_revisions_one_published_unique;
DROP INDEX IF EXISTS campaign_revisions_one_draft_unique;
DROP TABLE IF EXISTS campaign_revisions;
DROP INDEX IF EXISTS campaigns_production_status_idx;
DROP INDEX IF EXISTS campaigns_public_slug_unique;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS form_versions;
DROP INDEX IF EXISTS campaign_template_versions_template_idx;
DROP TABLE IF EXISTS campaign_template_versions;
DROP INDEX IF EXISTS campaign_templates_scope_kind_idx;
DROP TABLE IF EXISTS campaign_templates;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 25}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
