-- 回滚只恢复旧约束和默认值，不会把已转换的活动重新标记为 draft。
ALTER TABLE productions
    DROP CONSTRAINT IF EXISTS productions_status_check,
    ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE productions
    ADD CONSTRAINT productions_status_check
    CHECK (status IN ('draft', 'active', 'completed', 'archived'));

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 6}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
