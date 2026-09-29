ALTER TABLE campaign_revisions
    DROP CONSTRAINT IF EXISTS campaign_revisions_processing_mode_check;

ALTER TABLE campaign_revisions
    DROP COLUMN IF EXISTS processing_mode;
