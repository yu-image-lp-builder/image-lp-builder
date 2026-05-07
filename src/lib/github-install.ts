/**
 * Workspace ⇔ GitHub App installation mapping.
 *
 * The customer installs the yu-labs GitHub App on their fork via the
 * /admin/update install flow; the auth-relay collects the
 * installation_id and hands it back to /admin/update/oauth/callback.
 * That handler persists the row here so subsequent "Update now"
 * clicks can mint a fresh installation access token via the relay
 * without bouncing the customer through GitHub again.
 */

export interface InstallationRow {
  workspace_id: string;
  installation_id: number;
  installed_at: string;
  updated_at: string;
}

export const installationQueries = {
  async get(
    db: D1Database,
    workspaceId: string
  ): Promise<InstallationRow | null> {
    const row = await db
      .prepare(
        'SELECT * FROM workspace_github_installations WHERE workspace_id = ?'
      )
      .bind(workspaceId)
      .first<InstallationRow>();
    return row ?? null;
  },

  async upsert(
    db: D1Database,
    workspaceId: string,
    installationId: number
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO workspace_github_installations
           (workspace_id, installation_id, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(workspace_id) DO UPDATE SET
           installation_id = excluded.installation_id,
           updated_at = datetime('now')`
      )
      .bind(workspaceId, installationId)
      .run();
  },

  async delete(db: D1Database, workspaceId: string): Promise<void> {
    await db
      .prepare(
        'DELETE FROM workspace_github_installations WHERE workspace_id = ?'
      )
      .bind(workspaceId)
      .run();
  },
};
