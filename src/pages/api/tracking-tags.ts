/**
 * /api/tracking-tags
 *
 * GET -> read the singleton tracking_tags row (defaults applied if
 *        none exists yet)
 * PUT -> upsert tracking IDs + custom head HTML
 *
 * Authentication is enforced by middleware. Validation is light —
 * the IDs are opaque tokens issued by Google / Meta / Microsoft, we
 * just trim and length-check them.
 *
 * Security note: customHead is sanitized but still allows tracking
 * `<script>` tags. Pasted scripts share an origin with the admin
 * API while the admin is logged in — see README "Security
 * considerations".
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { trackingTagsQueries } from '../../lib/db';
import { success, errors } from '../../lib/api';
import { sanitizeCustomHead } from '../../lib/sanitize-head';

export const prerender = false;

const ID_MAX = 100;
const HTML_MAX = 8000;

interface MetaJson {
  customHead?: string;
}

function readMeta(metaRaw: string | null): MetaJson {
  if (!metaRaw) return {};
  try {
    const parsed = JSON.parse(metaRaw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as MetaJson;
  } catch {
    /* fall through */
  }
  return {};
}

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  try {
    const row = await trackingTagsQueries.get(env.DB, locals.workspace_id);
    if (!row) {
      return success({
        gtmId: null,
        ga4Id: null,
        clarityId: null,
        metaPixelId: null,
        customHead: '',
      });
    }
    const meta = readMeta(row.meta);
    return success({
      gtmId: row.gtm_id,
      ga4Id: row.ga4_id,
      clarityId: row.clarity_id,
      metaPixelId: row.meta_pixel_id,
      customHead: meta.customHead ?? '',
    });
  } catch (err) {
    console.error('GET /api/tracking-tags failed:', err);
    return errors.internalError('Failed to read tracking tags');
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

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

  function pickId(key: string): string | null | undefined {
    if (!(key in input)) return undefined;
    const value = input[key];
    if (value === null || value === '') return null;
    if (typeof value !== 'string')
      throw new Error(`\`${key}\` must be a string or null`);
    const trimmed = value.trim();
    if (trimmed.length > ID_MAX) throw new Error(`\`${key}\` is too long`);
    return trimmed;
  }

  let patch: {
    gtm_id?: string | null;
    ga4_id?: string | null;
    clarity_id?: string | null;
    meta_pixel_id?: string | null;
    meta?: string;
  };
  try {
    patch = {};
    const gtm = pickId('gtmId');
    const ga4 = pickId('ga4Id');
    const clarity = pickId('clarityId');
    const metaPixel = pickId('metaPixelId');
    if (gtm !== undefined) patch.gtm_id = gtm;
    if (ga4 !== undefined) patch.ga4_id = ga4;
    if (clarity !== undefined) patch.clarity_id = clarity;
    if (metaPixel !== undefined) patch.meta_pixel_id = metaPixel;

    if ('customHead' in input) {
      const value = input.customHead;
      if (value !== null && typeof value !== 'string') {
        throw new Error('`customHead` must be a string or null');
      }
      const html = value === null ? '' : value;
      if (html.length > HTML_MAX) {
        throw new Error(`\`customHead\` must be ${HTML_MAX} characters or fewer`);
      }
      // Sanitize before storage; PublicLayout sanitizes again at
      // render time as defense-in-depth.
      const safeHtml = sanitizeCustomHead(html);
      const existing = await trackingTagsQueries.get(env.DB, locals.workspace_id);
      const meta = readMeta(existing?.meta ?? null);
      meta.customHead = safeHtml;
      patch.meta = JSON.stringify(meta);
    }
  } catch (err) {
    return errors.validationError(
      err instanceof Error ? err.message : String(err)
    );
  }

  try {
    const updated = await trackingTagsQueries.upsert(env.DB, locals.workspace_id, patch);
    const meta = readMeta(updated.meta);
    return success({
      gtmId: updated.gtm_id,
      ga4Id: updated.ga4_id,
      clarityId: updated.clarity_id,
      metaPixelId: updated.meta_pixel_id,
      customHead: meta.customHead ?? '',
    });
  } catch (err) {
    console.error('PUT /api/tracking-tags failed:', err);
    return errors.internalError('Failed to update tracking tags');
  }
};
