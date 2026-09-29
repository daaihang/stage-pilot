ALTER TABLE campaign_revisions
    ADD COLUMN processing_mode TEXT NOT NULL DEFAULT 'MANUAL_DECISION';

UPDATE campaign_revisions
SET processing_mode = CASE
    WHEN review_workflow->>'mode' IN ('COLLECT_ONLY', 'DIRECT_MANUAL_DECISION', 'MANUAL_DECISION', 'AUTO_ACCEPT')
        THEN review_workflow->>'mode'
    ELSE 'MANUAL_DECISION'
END;

ALTER TABLE campaign_revisions
    ADD CONSTRAINT campaign_revisions_processing_mode_check
    CHECK (processing_mode IN ('COLLECT_ONLY', 'DIRECT_MANUAL_DECISION', 'MANUAL_DECISION', 'AUTO_ACCEPT'));
