CREATE INDEX entries_campaign_contact_email_limit_idx
    ON entries (workspace_id, campaign_id, contact_email)
    WHERE deleted_at IS NULL
      AND contact_email <> ''
      AND status NOT IN ('draft', 'withdrawn');

INSERT INTO app_metadata(key, value) VALUES('schema', '{"version":44}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
