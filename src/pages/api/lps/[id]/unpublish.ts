/**
 * POST /api/lps/:id/unpublish
 *
 * Move a published LP back to draft.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries } from '../../../../lib/db';
import { parseContent } from '../../../../lib/content';
import { success, errors } from '../../../../lib/api';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const existing = await pageQueries.findById(env.DB, workspaceId, id);
    if (!existing) {
      return errors.notFound(`LP \`${id}\` not found`);
    }

    if (existing.status !== 'published') {
      return errors.conflict(
        `LP \`${id}\` is not published (current status: \`${existing.status}\`)`,
        { currentStatus: existing.status }
      );
    }

    const updated = await pageQueries.unpublish(env.DB, workspaceId, id);
    if (!updated) {
      return errors.internalError('Failed to unpublish LP');
    }

    return success({
      ...updated,
      content: parseContent(updated.content),
    });
  } catch (err) {
    console.error(`POST /api/lps/${id}/unpublish failed:`, err);
    return errors.internalError('Failed to unpublish LP');
  }
};
