ALTER TABLE user_preferences DROP COLUMN IF EXISTS last_workspace_id;
DROP TABLE IF EXISTS workspace_memberships;
DROP TABLE IF EXISTS workspaces;
