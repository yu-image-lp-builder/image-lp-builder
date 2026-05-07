/**
 * DELETE /api/lps/:id/utm-links/:utmId
 *
 * Removes a UTM link. The /go/:shortPath URL stops working
 * immediately. (No "soft delete" — campaign links are usually
 * disposable.)
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { utmLinkQueries } from '../../../../../lib/db';
import { success, errors } from '../../../../../lib/api';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const utmId = params.utmId;
  if (typeof utmId !== 'string' || utmId.length === 0) {
    return errors.validationError('UTM link id is required', { field: 'utmId' });
  }
  try {
    const removed = await utmLinkQueries.remove(env.DB, workspaceId, utmId);
    if (!removed) return errors.notFound(`UTM link \`${utmId}\` not found`);
    return success({ id: utmId, removed: true });
  } catch (err) {
    console.error(`DELETE /api/lps/.../utm-links/${utmId} failed:`, err);
    return errors.internalError('Failed to delete UTM link');
  }
};
