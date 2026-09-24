ALTER TABLE entry_revisions
    ADD CONSTRAINT entry_revisions_workspace_entry_id_unique
    UNIQUE (workspace_id, entry_id, id);
ALTER TABLE entries
    ADD CONSTRAINT entries_review_revision_unique
    UNIQUE (workspace_id, id, campaign_revision_id);

CREATE TABLE entry_review_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    campaign_revision_id TEXT NOT NULL,
    entry_revision_id TEXT NOT NULL,
    workflow_snapshot JSONB NOT NULL CHECK (jsonb_typeof(workflow_snapshot) = 'object'),
    completion_mode TEXT NOT NULL CHECK (completion_mode IN ('all', 'at_least_n')),
    required_count INTEGER NOT NULL CHECK (required_count > 0),
    status TEXT NOT NULL CHECK (status IN ('awaiting_assignment', 'collecting_feedback', 'ready_for_decision', 'decided', 'blocked_unsupported', 'legacy_override_decided')),
    source TEXT NOT NULL CHECK (source IN ('submission', 'migration')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, entry_id),
    UNIQUE (workspace_id, id, entry_id),
    UNIQUE (workspace_id, id, campaign_revision_id, entry_revision_id),
    FOREIGN KEY (workspace_id, entry_id) REFERENCES entries(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, entry_id, campaign_revision_id) REFERENCES entries(workspace_id, id, campaign_revision_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, entry_revision_id, entry_id) REFERENCES entry_revisions(workspace_id, id, entry_id) ON DELETE RESTRICT
);
CREATE INDEX entry_review_runs_status_idx ON entry_review_runs(workspace_id, status, updated_at DESC);

CREATE TABLE entry_review_tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'closed_by_decision')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, run_id),
    FOREIGN KEY (workspace_id, run_id, entry_id) REFERENCES entry_review_runs(workspace_id, id, entry_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, entry_id) REFERENCES entries(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX entry_review_tasks_run_idx ON entry_review_tasks(workspace_id, run_id, status, created_at);

CREATE TABLE entry_review_task_assignments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL CHECK (source IN ('submission', 'migration_backfill', 'manual')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, run_id, task_id, reviewer_id),
    FOREIGN KEY (workspace_id, task_id, run_id) REFERENCES entry_review_tasks(workspace_id, id, run_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX entry_review_task_assignments_current_task_idx
    ON entry_review_task_assignments(workspace_id, task_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX entry_review_task_assignments_current_reviewer_idx
    ON entry_review_task_assignments(workspace_id, run_id, reviewer_id) WHERE ended_at IS NULL;
CREATE INDEX entry_review_task_assignments_reviewer_idx
    ON entry_review_task_assignments(workspace_id, reviewer_id, ended_at, assigned_at DESC);

CREATE TABLE entry_review_feedback (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    campaign_revision_id TEXT NOT NULL,
    entry_revision_id TEXT NOT NULL,
    recommendation TEXT NOT NULL CHECK (recommendation IN ('recommend', 'do_not_recommend', 'no_opinion')),
    comment TEXT NOT NULL CHECK (length(btrim(comment)) > 0 AND length(comment) <= 5000),
    supersedes_id TEXT,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, task_id),
    FOREIGN KEY (workspace_id, run_id, campaign_revision_id, entry_revision_id) REFERENCES entry_review_runs(workspace_id, id, campaign_revision_id, entry_revision_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, task_id, run_id) REFERENCES entry_review_tasks(workspace_id, id, run_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, assignment_id, run_id, task_id, reviewer_id) REFERENCES entry_review_task_assignments(workspace_id, id, run_id, task_id, reviewer_id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, campaign_revision_id) REFERENCES campaign_revisions(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, entry_revision_id) REFERENCES entry_revisions(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, supersedes_id, task_id) REFERENCES entry_review_feedback(workspace_id, id, task_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX entry_review_feedback_current_task_idx
    ON entry_review_feedback(workspace_id, task_id) WHERE is_current;
CREATE INDEX entry_review_feedback_run_history_idx
    ON entry_review_feedback(workspace_id, run_id, created_at DESC, id);

-- Backfill only unresolved Entries. Compatible snapshots get a migration-marked
-- run and current assignments; unsupported snapshots remain in an explicit queue.
WITH unresolved AS (
    SELECT e.id AS entry_id, e.workspace_id, e.production_id, e.campaign_revision_id,
           latest.id AS entry_revision_id, cr.review_workflow AS workflow,
           e.status <> 'needs_changes'
             AND cr.review_workflow->>'mode' = 'MANUAL_DECISION'
             AND CASE WHEN jsonb_typeof(cr.review_workflow->'rounds')='array' THEN jsonb_array_length(cr.review_workflow->'rounds')=1 ELSE false END
             AND COALESCE(cr.review_workflow->'rounds'->0->>'execution', '') = 'parallel'
             AND COALESCE(cr.review_workflow->'request_changes'->>'enabled', 'false') = 'false'
             AND COALESCE(cr.review_workflow->>'final_decision', 'manual') = 'manual'
             AND COALESCE(cr.review_workflow->'request_changes'->>'target', 'same_round') = 'same_round'
             AND COALESCE(cr.review_workflow->'rounds'->0->'feedback'->>'kind', '') = 'binary'
             AND CASE WHEN jsonb_typeof(cr.review_workflow->'rounds'->0->'scorecard'->'criteria')='array' THEN jsonb_array_length(cr.review_workflow->'rounds'->0->'scorecard'->'criteria')=0 ELSE true END
             AND COALESCE(cr.review_workflow->'rounds'->0->'completion'->>'mode', '') IN ('all','any','at_least_n')
             AND (COALESCE(cr.review_workflow->'rounds'->0->'completion'->>'mode', '') <> 'at_least_n'
                  OR COALESCE(cr.review_workflow->'rounds'->0->'completion'->>'n', '') ~ '^[1-9][0-9]*$')
             AND COALESCE(cr.review_workflow->'rounds'->0->'reviewer_policy'->>'source', '') IN ('explicit_members','production_roles')
             AND ((jsonb_typeof(cr.review_workflow->'rounds'->0->'reviewer_policy'->'member_ids')='array' AND cr.review_workflow->'rounds'->0->'reviewer_policy'->'member_ids' <> '[]'::jsonb)
               OR (jsonb_typeof(cr.review_workflow->'rounds'->0->'reviewer_policy'->'role_keys')='array' AND cr.review_workflow->'rounds'->0->'reviewer_policy'->'role_keys' <> '[]'::jsonb)) AS compatible
    FROM entries e
    JOIN campaign_revisions cr ON cr.workspace_id=e.workspace_id AND cr.id=e.campaign_revision_id
    LEFT JOIN LATERAL (
        SELECT er.id FROM entry_revisions er
        WHERE er.workspace_id=e.workspace_id AND er.entry_id=e.id
        ORDER BY er.revision_no DESC LIMIT 1
    ) latest ON TRUE
    WHERE e.deleted_at IS NULL AND e.current_decision_id IS NULL
      AND e.status IN ('submitted','in_review','needs_changes')
      AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.workspace_id=e.workspace_id AND d.entry_id=e.id AND d.is_current)
), resolved AS (
    SELECT u.*,
      CASE
        WHEN u.workflow->'rounds'->0->'completion'->>'mode' = 'all' THEN 'all'
        ELSE 'at_least_n'
      END AS completion_mode,
      CASE
        WHEN u.workflow->'rounds'->0->'completion'->>'mode' = 'all' THEN 1
        WHEN u.workflow->'rounds'->0->'completion'->>'mode' = 'any' THEN 1
        ELSE CASE WHEN COALESCE(u.workflow->'rounds'->0->'completion'->>'n','') ~ '^[1-9][0-9]*$'
                  THEN LEAST((u.workflow->'rounds'->0->'completion'->>'n')::numeric,2147483647)::integer ELSE 1 END
      END AS configured_required,
      COALESCE(reviewers.ids, ARRAY[]::text[]) AS reviewer_ids
    FROM unresolved u
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT candidates.user_id ORDER BY candidates.user_id) AS ids
      FROM (
        SELECT pm.user_id
        FROM production_memberships pm
        WHERE u.compatible
          AND pm.production_id=u.production_id AND pm.status='active'
          AND (pm.starts_at IS NULL OR pm.starts_at<=NOW())
          AND (pm.expires_at IS NULL OR pm.expires_at>NOW())
          AND pm.id=(SELECT current_pm.id FROM production_memberships current_pm
                     WHERE current_pm.production_id=pm.production_id AND current_pm.user_id=pm.user_id
                     ORDER BY current_pm.created_at DESC,current_pm.id DESC LIMIT 1)
          AND (
            (u.workflow->'rounds'->0->'reviewer_policy'->>'source'='explicit_members'
              AND ((u.workflow->'rounds'->0->'reviewer_policy'->'member_ids') ? pm.user_id
                OR EXISTS(SELECT 1 FROM production_memberships configured_pm
                          WHERE configured_pm.production_id=u.production_id AND configured_pm.user_id=pm.user_id
                            AND (u.workflow->'rounds'->0->'reviewer_policy'->'member_ids') ? configured_pm.id)))
            OR (u.workflow->'rounds'->0->'reviewer_policy'->>'source'='production_roles'
              AND (u.workflow->'rounds'->0->'reviewer_policy'->'role_keys') ? pm.role_key)
          )
        UNION
        SELECT wm.user_id
        FROM workspace_memberships wm
        WHERE u.compatible AND wm.workspace_id=u.workspace_id AND wm.status='active'
          AND (u.workflow->'rounds'->0->'reviewer_policy'->>'source'='explicit_members'
            AND (u.workflow->'rounds'->0->'reviewer_policy'->'member_ids') ? wm.user_id)
        UNION
        SELECT wm.user_id
        FROM workspace_memberships wm
        WHERE u.compatible AND wm.workspace_id=u.workspace_id AND wm.status='active'
          AND wm.role IN ('owner','admin')
          AND (u.workflow->'rounds'->0->'reviewer_policy'->>'source'='production_roles'
            AND (u.workflow->'rounds'->0->'reviewer_policy'->'role_keys') ? 'producer')
      ) candidates
    ) reviewers ON TRUE
), inserted_runs AS (
    INSERT INTO entry_review_runs(id,workspace_id,entry_id,campaign_revision_id,entry_revision_id,workflow_snapshot,completion_mode,required_count,status,source)
    SELECT md5(random()::text || clock_timestamp()::text || r.entry_id), r.workspace_id, r.entry_id,
           r.campaign_revision_id, r.entry_revision_id, r.workflow,
           r.completion_mode,
           CASE WHEN r.completion_mode='all' THEN GREATEST(cardinality(r.reviewer_ids),1) ELSE r.configured_required END,
           CASE WHEN NOT r.compatible THEN 'blocked_unsupported'
                WHEN cardinality(r.reviewer_ids) < CASE WHEN r.completion_mode='all' THEN GREATEST(cardinality(r.reviewer_ids),1) ELSE r.configured_required END THEN 'awaiting_assignment'
                ELSE 'collecting_feedback' END,
           'migration'
    FROM resolved r
    WHERE r.entry_revision_id IS NOT NULL
    ON CONFLICT (workspace_id,entry_id) DO NOTHING
    RETURNING id,workspace_id,entry_id,campaign_revision_id,entry_revision_id,workflow_snapshot,status
), reviewer_tasks AS (
    SELECT md5(random()::text || clock_timestamp()::text || ir.id || reviewer.user_id) AS task_id,
           ir.workspace_id, ir.id AS run_id, ir.entry_id, reviewer.user_id AS reviewer_id
    FROM inserted_runs ir
    JOIN resolved r ON r.workspace_id=ir.workspace_id AND r.entry_id=ir.entry_id
    CROSS JOIN LATERAL unnest(r.reviewer_ids) AS reviewer(user_id)
), inserted_tasks AS (
    INSERT INTO entry_review_tasks(id,workspace_id,run_id,entry_id)
    SELECT task_id,workspace_id,run_id,entry_id FROM reviewer_tasks
    RETURNING id,workspace_id,run_id,entry_id
)
INSERT INTO entry_review_task_assignments(id,workspace_id,run_id,task_id,reviewer_id,reason,source)
SELECT md5(random()::text || clock_timestamp()::text || task.task_id), task.workspace_id, task.run_id, task.task_id,
       task.reviewer_id, '迁移时按当前有效配置回填；不代表历史分配记录', 'migration_backfill'
FROM reviewer_tasks task
JOIN inserted_tasks inserted ON inserted.workspace_id=task.workspace_id AND inserted.id=task.task_id;

UPDATE entries e SET status='in_review',updated_at=NOW()
FROM entry_review_runs r
WHERE r.workspace_id=e.workspace_id AND r.entry_id=e.id AND r.source='migration'
  AND r.status <> 'blocked_unsupported' AND e.status='submitted';

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":45}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
