/**
 * /api/lps/:id/ab
 *
 * PATCH -> update the A/B metadata (label + weight) of a variant.
 *
 * The id here is the *variant* id, not the parent. Returns 404 if
 * the page isn't an ab_variant.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries } from '../../../../lib/db';
import { errors, success } from '../../../../lib/api';

export const prerender = false;

const LABEL_MAX_LENGTH = 100;

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('Variant id is required', { field: 'id' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Body must be a JSON object');
  }
  const obj = body as Record<string, unknown>;

  const rawLabel = obj.label;
  if (typeof rawLabel !== 'string') {
    return errors.validationError('`label` is required', { field: 'label' });
  }
  const label = rawLabel.trim();
  if (label.length === 0 || label.length > LABEL_MAX_LENGTH) {
    return errors.validationError(
      `\`label\` must be 1-${LABEL_MAX_LENGTH} characters`,
      { field: 'label' }
    );
  }

  const rawWeight = obj.weight;
  if (typeof rawWeight !== 'number' || rawWeight < 0) {
    return errors.validationError('`weight` must be a non-negative number', {
      field: 'weight',
    });
  }

  try {
    const updated = await pageQueries.updateVariantAb(
      env.DB,
      workspaceId,
      id,
      {
        label,
        weight: rawWeight,
      }
    );
    if (!updated) {
      return errors.notFound(`Variant \`${id}\` not found`);
    }
    return success({
      variant: {
        id: updated.id,
        status: updated.status,
        label,
        weight: rawWeight,
        updatedAt: updated.updated_at,
      },
    });
  } catch (err) {
    console.error(`PATCH /api/lps/${id}/ab failed:`, err);
    return errors.internalError('Failed to update variant');
  }
};
