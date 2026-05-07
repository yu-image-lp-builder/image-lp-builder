-- Per-workspace mapping to the customer's GitHub App installation.
--
-- During the /admin/update install flow the auth-relay returns an
-- installation_id (numeric) which we persist here. The "Update now"
-- API later re-uses it to mint a fresh installation access token via
-- the relay without sending the customer back through GitHub.
--
-- workspace_id is the primary key: today every Worker ships with a
-- single workspace, but the column matches every other table so a
-- future multi-workspace mode wouldn't need a schema change.

CREATE TABLE workspace_github_installations (
  workspace_id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO schema_migrations (version) VALUES ('0013_workspace_github_installations');
