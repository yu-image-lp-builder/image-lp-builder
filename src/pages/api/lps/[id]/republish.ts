/**
 * POST /api/lps/:id/republish
 *
 * Promote the working copy (`content`) to the public snapshot
 * (`live_content`). Use this to push pending edits on an already-
 * published LP — the public URL only changes when this endpoint is
 * called, not on every save.
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
        `LP \`${id}\` must be published before it can be re-published`,
        { currentStatus: existing.status }
      );
    }

    if (existing.live_content === existing.content) {
      // Idempotent — nothing pending. Return the row as-is so the UI
      // can refresh state without surfacing an error.
      return success({
        ...existing,
        content: parseContent(existing.content),
      });
    }

    const updated = await pageQueries.republish(env.DB, workspaceId, id);
    if (!updated) {
      return errors.internalError('Failed to re-publish LP');
    }

    return success({
      ...updated,
      content: parseContent(updated.content),
    });
  } catch (err) {
    console.error(`POST /api/lps/${id}/republish failed:`, err);
    return errors.internalError('Failed to re-publish LP');
  }
};
