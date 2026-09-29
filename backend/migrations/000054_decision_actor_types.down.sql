DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM decisions WHERE actor_type = 'system') THEN
        RAISE EXCEPTION 'cannot roll back decision actor types while system Decisions exist';
    END IF;
END $$;

ALTER TABLE decisions
    DROP CONSTRAINT IF EXISTS decisions_actor_consistency_check;

ALTER TABLE decisions
    ALTER COLUMN decided_by SET NOT NULL;

ALTER TABLE decisions
    DROP COLUMN IF EXISTS actor_type;
