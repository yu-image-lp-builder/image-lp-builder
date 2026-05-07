
ALTER TABLE pages
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_pages_workspace_id ON pages(workspace_id);

ALTER TABLE page_meta
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_page_meta_workspace_id ON page_meta(workspace_id);

ALTER TABLE my_links
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_my_links_workspace_id ON my_links(workspace_id);

ALTER TABLE connections
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_connections_workspace_id ON connections(workspace_id);

ALTER TABLE utm_links
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_utm_links_workspace_id ON utm_links(workspace_id);

ALTER TABLE mcp_tokens
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_mcp_tokens_workspace_id ON mcp_tokens(workspace_id);

INSERT INTO schema_migrations (version) VALUES ('0008_workspace_id');
