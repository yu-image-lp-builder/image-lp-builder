/**
 * /api/mcp-tokens/:id
 *
 * DELETE -> revoke a token (sets revoked_at; row is kept for audit).
 *
 * Revocation is immediate: subsequent /mcp requests with that token
 * return 401 because findActiveByHash filters out revoked rows.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { mcpTokenQueries } from '../../../lib/db';
import { errors, success } from '../../../lib/api';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('Token id is required', { field: 'id' });
  }

  try {
    const revoked = await mcpTokenQueries.revoke(env.DB, workspaceId, id);
    if (!revoked) {
      return errors.notFound(`Token \`${id}\` not found or already revoked`);
    }
    return success({ revoked: true, id });
  } catch (err) {
    console.error(`DELETE /api/mcp-tokens/${id} failed:`, err);
    return errors.internalError('Failed to revoke MCP token');
  }
};
