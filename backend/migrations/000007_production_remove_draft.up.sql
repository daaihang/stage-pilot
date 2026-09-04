-- Production 没有 draft 生命周期：历史 draft 数据统一进入正式 active 状态。
UPDATE productions
SET status = 'active'
WHERE status = 'draft';

ALTER TABLE productions
    DROP CONSTRAINT IF EXISTS productions_status_check,
    ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE productions
    ADD CONSTRAINT productions_status_check
    CHECK (status IN ('active', 'completed', 'archived'));

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 7}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
