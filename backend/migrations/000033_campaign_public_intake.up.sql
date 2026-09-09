-- Campaign Intake Execution V1: stable public share credentials and
-- anonymous submission idempotency.  Share links point at a Campaign (not a
-- revision), so publishing a new revision does not invalidate the URL.

CREATE TABLE campaign_share_links (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    production_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    long_token_hash TEXT NOT NULL UNIQUE,
    short_code_hash TEXT NOT NULL UNIQUE,
    long_token_ciphertext TEXT NOT NULL,
    short_code_ciphertext TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, campaign_id, production_id)
        REFERENCES campaigns(workspace_id, id, production_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX campaign_share_links_one_active_idx
    ON campaign_share_links (workspace_id, campaign_id)
    WHERE revoked_at IS NULL;
CREATE INDEX campaign_share_links_lookup_long_idx
    ON campaign_share_links (long_token_hash)
    WHERE revoked_at IS NULL;
CREATE INDEX campaign_share_links_lookup_short_idx
    ON campaign_share_links (short_code_hash)
    WHERE revoked_at IS NULL;

CREATE TABLE campaign_public_submission_idempotency (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL,
    share_link_id TEXT NOT NULL,
    idempotency_key_hash TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
    response_status INTEGER,
    response_body JSONB,
    entry_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, share_link_id, idempotency_key_hash),
    FOREIGN KEY (workspace_id, campaign_id) REFERENCES campaigns(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, share_link_id) REFERENCES campaign_share_links(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, entry_id) REFERENCES entries(workspace_id, id) ON DELETE SET NULL,
    CHECK ((status = 'pending' AND completed_at IS NULL) OR (status IN ('succeeded', 'failed') AND completed_at IS NOT NULL))
);
CREATE INDEX campaign_public_submission_idempotency_expiry_idx
    ON campaign_public_submission_idempotency (expires_at);

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version":33}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
