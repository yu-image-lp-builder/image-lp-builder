/**
 * /api/my-links/:id
 *
 * GET    -> retrieve one MyLink
 * PUT    -> update label / url
 * DELETE -> remove (CTAs that reference this id will fall back to
 *           their inline url/number/email — caller should warn)
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { myLinkQueries } from '../../../lib/db';
import { success, errors } from '../../../lib/api';
import { validateLabel, validateUrl } from '../my-links';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('MyLink id is required', { field: 'id' });
  }
  try {
    const link = await myLinkQueries.findById(env.DB, workspaceId, id);
    if (!link) return errors.notFound(`MyLink \`${id}\` not found`);
    return success(link);
  } catch (err) {
    console.error(`GET /api/my-links/${id} failed:`, err);
    return errors.internalError('Failed to retrieve MyLink');
  }
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('MyLink id is required', { field: 'id' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Request body must be valid JSON');
  }

  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Request body must be a JSON object');
  }

  const { label, url } = body as { label?: unknown; url?: unknown };
  const labelError = validateLabel(label);
  const urlError = validateUrl(url);
  if (labelError) return errors.validationError(labelError, { field: 'label' });
  if (urlError) return errors.validationError(urlError, { field: 'url' });

  try {
    const updated = await myLinkQueries.update(env.DB, workspaceId, id, {
      label: (label as string).trim(),
      url: (url as string).trim(),
    });
    if (!updated) return errors.notFound(`MyLink \`${id}\` not found`);
    return success(updated);
  } catch (err) {
    console.error(`PUT /api/my-links/${id} failed:`, err);
    return errors.internalError('Failed to update MyLink');
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('MyLink id is required', { field: 'id' });
  }
  try {
    const removed = await myLinkQueries.remove(env.DB, workspaceId, id);
    if (!removed) return errors.notFound(`MyLink \`${id}\` not found`);
    return success({ id, removed: true });
  } catch (err) {
    console.error(`DELETE /api/my-links/${id} failed:`, err);
    return errors.internalError('Failed to delete MyLink');
  }
};
