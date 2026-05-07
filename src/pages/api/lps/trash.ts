/**
 * GET /api/lps/trash
 *
 * List all LPs currently in trash, newest-trashed first. Powers the
 * trash section in /admin so the operator can restore or permanently
 * delete soft-deleted pages.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries } from '../../../lib/db';
import { errors, success } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  try {
    const pages = await pageQueries.listTrash(env.DB, workspaceId);
    return success({
      pages: pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        trashed_at: p.trashed_at,
        updated_at: p.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/lps/trash failed:', err);
    return errors.internalError('Failed to list trash');
  }
};
