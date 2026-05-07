/**
 * POST /api/lps/:id/publish
 *
 * Transition an LP from draft / preview / archived to published.
 * Sets `published_at` to now if it's the first publish; preserves
 * the original timestamp on re-publish.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries } from '../../../../lib/db';
import { parseContent } from '../../../../lib/content';
import { success, errors } from '../../../../lib/api';

export const prerender = false;

const PUBLISHABLE_STATUSES = new Set(['draft', 'preview', 'archived']);

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

    if (existing.status === 'published') {
      return errors.conflict(`LP \`${id}\` is already published`, {
        currentStatus: existing.status,
      });
    }

    if (!PUBLISHABLE_STATUSES.has(existing.status)) {
      return errors.conflict(
        `LP \`${id}\` cannot be published from status \`${existing.status}\``,
        {
          currentStatus: existing.status,
          allowedFrom: Array.from(PUBLISHABLE_STATUSES),
        }
      );
    }

    const updated = await pageQueries.publish(env.DB, workspaceId, id);
    if (!updated) {
      return errors.internalError('Failed to publish LP');
    }

    return success({
      ...updated,
      content: parseContent(updated.content),
    });
  } catch (err) {
    console.error(`POST /api/lps/${id}/publish failed:`, err);
    return errors.internalError('Failed to publish LP');
  }
};
