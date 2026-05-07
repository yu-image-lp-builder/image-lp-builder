/**
 * Bearer-token authentication for the /mcp endpoint.
 *
 * The /mcp endpoint sits outside the OAuth-protected admin surface
 * so that AI clients (Claude Desktop, IDEs, custom agents) can
 * call it directly with a long-lived token. The token is issued from
 * the admin UI, stored hashed (SHA-256) in mcp_tokens, and presented
 * by the client via `Authorization: Bearer <token>`.
 */

import {
  hashMcpToken,
  mcpSettingsQueries,
  mcpTokenQueries,
  type McpSettings,
  type McpToken,
} from '../db';

export type McpAuthSuccess = {
  ok: true;
  token: McpToken;
  settings: McpSettings;
};

export type McpAuthFailure = {
  ok: false;
  status: number;
  message: string;
};

export type McpAuthResult = McpAuthSuccess | McpAuthFailure;

/**
 * Parse `Authorization: Bearer <token>` and look up the matching
 * non-revoked mcp_token row. Returns the token row and the current
 * mcp_settings (so the caller can mode-gate write/delete tools in
 * one shot).
 *
 * Side effect: bumps `mcp_tokens.last_used_at` on success.
 */
export async function authenticateMcpRequest(
  request: Request,
  db: D1Database
): Promise<McpAuthResult> {
  const header = request.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return {
      ok: false,
      status: 401,
      message: 'Missing or malformed Authorization header',
    };
  }

  const raw = header.slice(7).trim();
  if (raw.length === 0) {
    return { ok: false, status: 401, message: 'Empty bearer token' };
  }

  const tokenHash = await hashMcpToken(raw);
  const token = await mcpTokenQueries.findActiveByHash(db, tokenHash);
  if (!token) {
    return { ok: false, status: 401, message: 'Invalid or revoked token' };
  }

  // mcp_settings is per-workspace, so the enabled check has to come
  // after we resolve the token to a workspace.
  const settings = await mcpSettingsQueries.get(db, token.workspace_id);
  if (!settings.enabled) {
    return {
      ok: false,
      status: 503,
      message: 'MCP endpoint is disabled',
    };
  }

  // Fire-and-forget; failure to update last_used_at must not block the request.
  mcpTokenQueries.touchLastUsed(db, token.id).catch(() => {});

  return { ok: true, token, settings };
}
