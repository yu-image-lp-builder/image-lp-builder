/**
 * POST /api/lps/:id/restore
 *
 * Move a trashed LP back to draft so it shows up in the regular LP
 * list again. No-op (404) if the row isn't currently in trash.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries } from '../../../../lib/db';
import { errors, success } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const restored = await pageQueries.restore(env.DB, workspaceId, id);
    if (!restored) {
      return errors.notFound(`LP \`${id}\` not found in trash`);
    }
    return success(restored);
  } catch (err) {
    console.error(`POST /api/lps/${id}/restore failed:`, err);
    return errors.internalError('Failed to restore LP');
  }
};
