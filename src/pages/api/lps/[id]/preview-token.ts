/**
 * /api/lps/:id/preview-token
 *
 * GET    -> return the current preview token (or null if not issued)
 * POST   -> issue a fresh token (rotates the existing one if any),
 *           returns { token, url }
 * DELETE -> revoke the current token
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries, generateId } from '../../../../lib/db';
import { success, errors } from '../../../../lib/api';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }
  try {
    const lp = await pageQueries.findById(env.DB, workspaceId, id);
    if (!lp) return errors.notFound(`LP \`${id}\` not found`);
    return success({ token: lp.preview_token });
  } catch (err) {
    console.error(`GET /api/lps/${id}/preview-token failed:`, err);
    return errors.internalError('Failed to read preview token');
  }
};

export const POST: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }
  try {
    const existing = await pageQueries.findById(env.DB, workspaceId, id);
    if (!existing) return errors.notFound(`LP \`${id}\` not found`);

    const token = generateId();
    const updated = await pageQueries.setPreviewToken(
      env.DB,
      workspaceId,
      id,
      token
    );
    if (!updated) return errors.internalError('Failed to issue preview token');
    return success({ token: updated.preview_token });
  } catch (err) {
    console.error(`POST /api/lps/${id}/preview-token failed:`, err);
    return errors.internalError('Failed to issue preview token');
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }
  try {
    const updated = await pageQueries.setPreviewToken(
      env.DB,
      workspaceId,
      id,
      null
    );
    if (!updated) return errors.notFound(`LP \`${id}\` not found`);
    return success({ token: null });
  } catch (err) {
    console.error(`DELETE /api/lps/${id}/preview-token failed:`, err);
    return errors.internalError('Failed to revoke preview token');
  }
};
