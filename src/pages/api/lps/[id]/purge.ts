/**
 * DELETE /api/lps/:id/purge
 *
 * Permanently delete a trashed LP. Caller (admin UI) must confirm
 * with the user — this row will be gone forever, page_meta /
 * utm_links cascade-delete with it. Refuses if the LP is not in
 * trash, so an accidental call against a live LP can't wipe it.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries } from '../../../../lib/db';
import { errors, success } from '../../../../lib/api';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

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
    if (existing.status !== 'trash') {
      return errors.conflict(
        `LP \`${id}\` is not in trash; move it to trash first`,
        { currentStatus: existing.status }
      );
    }

    const purged = await pageQueries.purge(env.DB, workspaceId, id);
    if (!purged) {
      return errors.internalError('Failed to purge LP');
    }
    return success({ purged: true, id });
  } catch (err) {
    console.error(`DELETE /api/lps/${id}/purge failed:`, err);
    return errors.internalError('Failed to purge LP');
  }
};
