
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- ip_hash / ua_hash are SHA-256 digests, not raw values, to keep
  -- the table free of personal data even if it leaks.
  ip_hash TEXT,
  ua_hash TEXT
);

CREATE INDEX idx_sessions_workspace_id ON sessions(workspace_id);
CREATE INDEX idx_sessions_last_seen_at ON sessions(last_seen_at);

CREATE TABLE page_views (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT
);

CREATE INDEX idx_page_views_page_id ON page_views(page_id);
CREATE INDEX idx_page_views_session_id ON page_views(session_id);
CREATE INDEX idx_page_views_workspace_id ON page_views(workspace_id);
CREATE INDEX idx_page_views_viewed_at ON page_views(viewed_at);

-- Recorded by a sendBeacon POST so external CTAs are still captured
-- even though the navigation leaves the site immediately.
CREATE TABLE clicks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  page_id TEXT NOT NULL,
  cta_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  link_type TEXT,
  destination_url TEXT,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clicks_page_id ON clicks(page_id);
CREATE INDEX idx_clicks_session_id ON clicks(session_id);
CREATE INDEX idx_clicks_cta_id ON clicks(cta_id);
CREATE INDEX idx_clicks_workspace_id ON clicks(workspace_id);
CREATE INDEX idx_clicks_clicked_at ON clicks(clicked_at);

INSERT INTO schema_migrations (version) VALUES ('0010_session_tracking');
