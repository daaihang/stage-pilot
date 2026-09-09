-- API idempotency records for mutating requests that need safe retries.
-- Records are scoped to the authenticated actor, workspace, method and route.

CREATE TABLE api_idempotency_keys (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('POST', 'PATCH', 'PUT', 'DELETE')),
    route TEXT NOT NULL CHECK (btrim(route) <> ''),
    idempotency_key TEXT NOT NULL CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 255),
    request_hash TEXT NOT NULL CHECK (char_length(request_hash) = 64),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
    response_status INTEGER,
    response_body JSONB,
    resource_kind TEXT,
    resource_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    UNIQUE (workspace_id, actor_user_id, method, route, idempotency_key),
    CHECK ((status = 'pending' AND response_status IS NULL AND completed_at IS NULL)
        OR (status IN ('succeeded', 'failed') AND response_status IS NOT NULL AND completed_at IS NOT NULL)),
    CHECK (response_body IS NULL OR jsonb_typeof(response_body) IN ('object', 'array'))
);

CREATE INDEX api_idempotency_keys_expiry_idx
    ON api_idempotency_keys (expires_at)
    WHERE expires_at IS NOT NULL;

INSERT INTO app_metadata (key, value)
VALUES ('schema', '{"version": 28}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
