DROP TABLE IF EXISTS entry_review_feedback;
DROP TABLE IF EXISTS entry_review_task_assignments;
DROP TABLE IF EXISTS entry_review_tasks;
DROP TABLE IF EXISTS entry_review_runs;
ALTER TABLE entry_revisions DROP CONSTRAINT IF EXISTS entry_revisions_workspace_entry_id_unique;
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_review_revision_unique;

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":44}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
