DROP INDEX IF EXISTS membership_audit_events_membership_idx;
DROP INDEX IF EXISTS membership_audit_events_workspace_idx;
DROP TABLE IF EXISTS membership_audit_events;
DROP INDEX IF EXISTS workspace_memberships_active_idx;
UPDATE workspace_memberships SET status='suspended',revoked_at=NULL WHERE status='revoked';
ALTER TABLE workspace_memberships DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE workspace_memberships DROP CONSTRAINT IF EXISTS workspace_memberships_status_check;
ALTER TABLE workspace_memberships
    ADD CONSTRAINT workspace_memberships_status_check
    CHECK (status IN ('active', 'invited', 'suspended'));

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":37}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
