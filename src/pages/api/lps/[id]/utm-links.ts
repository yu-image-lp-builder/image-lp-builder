/**
 * /api/lps/:id/utm-links
 *
 * GET  -> list UTM links for the LP
 * POST -> create a new UTM link with an auto-generated short_path
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  pageQueries,
  utmLinkQueries,
  generateId,
  generateShortPath,
} from '../../../../lib/db';
import { success, errors } from '../../../../lib/api';

export const prerender = false;

const LABEL_MAX = 80;
const FIELD_MAX = 200;

function pickField(
  raw: unknown,
  field: string
): { value: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') {
    return { value: null, error: `\`${field}\` must be a string or null` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > FIELD_MAX) {
    return { value: null, error: `\`${field}\` is too long` };
  }
  return { value: trimmed };
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }
  try {
    const links = await utmLinkQueries.listByPage(env.DB, workspaceId, id);
    return success({ utmLinks: links });
  } catch (err) {
    console.error(`GET /api/lps/${id}/utm-links failed:`, err);
    return errors.internalError('Failed to list UTM links');
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
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

  const input = body as Record<string, unknown>;

  const labelRaw = input.label;
  if (typeof labelRaw !== 'string' || labelRaw.trim().length === 0) {
    return errors.validationError('`label` is required', { field: 'label' });
  }
  if (labelRaw.length > LABEL_MAX) {
    return errors.validationError(
      `\`label\` must be ${LABEL_MAX} characters or fewer`,
      { field: 'label' }
    );
  }

  const fields = {
    utmSource: pickField(input.utmSource, 'utmSource'),
    utmMedium: pickField(input.utmMedium, 'utmMedium'),
    utmCampaign: pickField(input.utmCampaign, 'utmCampaign'),
    utmContent: pickField(input.utmContent, 'utmContent'),
    utmTerm: pickField(input.utmTerm, 'utmTerm'),
  };
  for (const [key, result] of Object.entries(fields)) {
    if (result.error) {
      return errors.validationError(result.error, { field: key });
    }
  }

  try {
    const lp = await pageQueries.findById(env.DB, workspaceId, id);
    if (!lp) return errors.notFound(`LP \`${id}\` not found`);

    // Generate a unique short_path with a few retries on collision
    let shortPath = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      shortPath = generateShortPath(6 + Math.floor(attempt / 2));
      const taken = await utmLinkQueries.existsByShortPath(env.DB, shortPath);
      if (!taken) break;
      if (attempt === 5) {
        return errors.internalError('Could not allocate a unique short URL');
      }
    }

    const created = await utmLinkQueries.create(env.DB, workspaceId, {
      id: generateId(),
      pageId: id,
      label: labelRaw.trim(),
      utmSource: fields.utmSource.value,
      utmMedium: fields.utmMedium.value,
      utmCampaign: fields.utmCampaign.value,
      utmContent: fields.utmContent.value,
      utmTerm: fields.utmTerm.value,
      shortPath,
    });
    return success(created, 201);
  } catch (err) {
    console.error(`POST /api/lps/${id}/utm-links failed:`, err);
    return errors.internalError('Failed to create UTM link');
  }
};
