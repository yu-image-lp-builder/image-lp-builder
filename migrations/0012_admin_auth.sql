
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  email TEXT NOT NULL,
  google_sub TEXT,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  UNIQUE(workspace_id, email)
);

CREATE INDEX idx_admin_users_workspace ON admin_users(workspace_id);
CREATE INDEX idx_admin_users_workspace_email ON admin_users(workspace_id, email);
CREATE INDEX idx_admin_users_workspace_sub ON admin_users(workspace_id, google_sub);

CREATE TABLE admin_sessions (
  -- The token here is the cookie value itself (opaque session token),
  -- compared directly against the inbound Cookie. Not a hash — the
  -- server needs to look up the row by the exact cookie value.
  token TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_admin_sessions_workspace ON admin_sessions(workspace_id);
CREATE INDEX idx_admin_sessions_user ON admin_sessions(admin_user_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

INSERT INTO schema_migrations (version) VALUES ('0012_admin_auth');
