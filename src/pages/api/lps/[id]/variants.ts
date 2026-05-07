/**
 * /api/lps/:id/variants
 *
 * GET  -> list A/B variants of this LP
 * POST -> create a new variant (forks the parent's current content)
 *
 * Authentication is enforced by middleware. The :id in the path is
 * the *parent* LP id. Variants reuse the parent's slug — distribution
 * at /[slug] picks which one is served.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { generateId, pageQueries } from '../../../../lib/db';
import { errors, success } from '../../../../lib/api';
import { readAbMeta } from '../../../../lib/ab-test';

export const prerender = false;

const LABEL_MAX_LENGTH = 100;

export const GET: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const variants = await pageQueries.listVariants(env.DB, workspaceId, id);
    return success({
      variants: variants.map((v) => {
        const ab = readAbMeta(v, '案');
        return {
          id: v.id,
          status: v.status,
          label: ab.label,
          weight: ab.weight,
          createdAt: v.created_at,
          updatedAt: v.updated_at,
        };
      }),
    });
  } catch (err) {
    console.error(`GET /api/lps/${id}/variants failed:`, err);
    return errors.internalError('Failed to list variants');
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const parentId = params.id;
  if (typeof parentId !== 'string' || parentId.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
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
  const weight =
    typeof rawWeight === 'number' && rawWeight >= 0 ? rawWeight : 1;

  try {
    const parent = await pageQueries.findById(env.DB, workspaceId, parentId);
    if (!parent) {
      return errors.notFound(`LP \`${parentId}\` not found`);
    }
    if (parent.page_type !== 'lp') {
      return errors.validationError(
        'Variants can only be created from top-level LPs',
        { parent_type: parent.page_type }
      );
    }

    const created = await pageQueries.createVariant(env.DB, workspaceId, {
      id: generateId(),
      parentId,
      slug: parent.slug,
      label,
      weight,
      content: parent.content, // fork from parent's current content
    });

    return success(
      {
        variant: {
          id: created.id,
          status: created.status,
          label,
          weight,
          createdAt: created.created_at,
          updatedAt: created.updated_at,
        },
      },
      201
    );
  } catch (err) {
    console.error(`POST /api/lps/${parentId}/variants failed:`, err);
    return errors.internalError('Failed to create variant');
  }
};
