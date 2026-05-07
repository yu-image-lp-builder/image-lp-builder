/**
 * /api/mcp-settings
 *
 * GET -> current MCP mode + enabled flag
 * PUT -> partial update (mode and/or enabled)
 *
 * Authenticated via the standard /api/* middleware (OAuth in prod,
 * dev user locally). Distinct from /mcp itself, which uses
 * its own bearer-token auth.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { mcpSettingsQueries, type McpMode } from '../../lib/db';
import { errors, success } from '../../lib/api';

export const prerender = false;

const VALID_MODES: McpMode[] = ['read_only', 'edit_no_delete', 'edit_full'];

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  try {
    const settings = await mcpSettingsQueries.get(env.DB, locals.workspace_id);
    return success({
      mode: settings.mode,
      enabled: settings.enabled === 1,
      updatedAt: settings.updated_at,
    });
  } catch (err) {
    console.error('GET /api/mcp-settings failed:', err);
    return errors.internalError('Failed to load MCP settings');
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Body must be a JSON object');
  }

  const obj = body as Record<string, unknown>;
  const update: { mode?: McpMode; enabled?: boolean } = {};

  if (obj.mode !== undefined) {
    if (typeof obj.mode !== 'string' || !VALID_MODES.includes(obj.mode as McpMode)) {
      return errors.validationError(
        `\`mode\` must be one of: ${VALID_MODES.join(', ')}`,
        { field: 'mode' }
      );
    }
    update.mode = obj.mode as McpMode;
  }

  if (obj.enabled !== undefined) {
    if (typeof obj.enabled !== 'boolean') {
      return errors.validationError('`enabled` must be a boolean', {
        field: 'enabled',
      });
    }
    update.enabled = obj.enabled;
  }

  try {
    const updated = await mcpSettingsQueries.update(env.DB, locals.workspace_id, update);
    return success({
      mode: updated.mode,
      enabled: updated.enabled === 1,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    console.error('PUT /api/mcp-settings failed:', err);
    return errors.internalError('Failed to update MCP settings');
  }
};
