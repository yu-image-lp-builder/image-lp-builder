/**
 * /api/my-links
 *
 * GET  -> list all MyLinks (newest first)
 * POST -> create a new MyLink
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { myLinkQueries, generateId } from '../../lib/db';
import { success, errors } from '../../lib/api';
import { validateUrlScheme } from '../../lib/url';

export const prerender = false;

const LABEL_MAX_LENGTH = 50;
const URL_MAX_LENGTH = 2048;

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  try {
    const links = await myLinkQueries.list(env.DB, workspaceId);
    return success({ myLinks: links });
  } catch (err) {
    console.error('GET /api/my-links failed:', err);
    return errors.internalError('Failed to list MyLinks');
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;

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
    const created = await myLinkQueries.create(env.DB, workspaceId, {
      id: generateId(),
      label: (label as string).trim(),
      url: (url as string).trim(),
    });
    return success(created, 201);
  } catch (err) {
    console.error('POST /api/my-links failed:', err);
    return errors.internalError('Failed to create MyLink');
  }
};

export function validateLabel(value: unknown): string | null {
  if (typeof value !== 'string') return '`label` is required and must be a string';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '`label` cannot be empty';
  if (trimmed.length > LABEL_MAX_LENGTH)
    return `\`label\` must be ${LABEL_MAX_LENGTH} characters or fewer`;
  return null;
}

export function validateUrl(value: unknown): string | null {
  if (typeof value !== 'string') return '`url` is required and must be a string';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '`url` cannot be empty';
  if (trimmed.length > URL_MAX_LENGTH)
    return `\`url\` must be ${URL_MAX_LENGTH} characters or fewer`;
  // Block `javascript:` / `data:` etc. so a stored MyLink can't smuggle
  // an XSS payload into a CTA href.
  return validateUrlScheme(trimmed, { kind: 'relative-or-absolute' });
}
