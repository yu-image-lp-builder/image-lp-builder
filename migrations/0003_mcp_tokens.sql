
CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  -- SHA-256 of the bearer token; the plain token is shown to the
  -- user once and never persisted.
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX idx_mcp_tokens_hash ON mcp_tokens(token_hash);

INSERT INTO schema_migrations (version) VALUES ('0003_mcp_tokens');
