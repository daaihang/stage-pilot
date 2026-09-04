-- One-time compatibility backfill: every historical production creator receives
-- a durable Producer membership, including creators who are only Workspace members.
INSERT INTO production_memberships (
    id, production_id, user_id, role_key, status, invited_by
)
SELECT
    md5(random()::text || clock_timestamp()::text || p.id::text),
    p.id,
    p.created_by,
    'producer',
    'active',
    p.created_by
FROM productions p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM production_memberships pm
      WHERE pm.production_id = p.id
        AND pm.user_id = p.created_by
        AND pm.status <> 'revoked'
  );

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 10}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
