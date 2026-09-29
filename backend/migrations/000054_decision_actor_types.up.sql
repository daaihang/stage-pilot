ALTER TABLE decisions
    ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user', 'system'));

ALTER TABLE decisions
    ALTER COLUMN decided_by DROP NOT NULL;

ALTER TABLE decisions
    ADD CONSTRAINT decisions_actor_consistency_check
    CHECK (
        (actor_type = 'user' AND decided_by IS NOT NULL)
        OR (actor_type = 'system' AND decided_by IS NULL)
    );
