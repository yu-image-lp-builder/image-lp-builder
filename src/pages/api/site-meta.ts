/**
 * /api/site-meta
 *
 * GET -> read the singleton site_meta row (defaults applied if
 *        none exists yet)
 * PUT -> upsert favicon URL / OGP default / apple-touch-icon URL
 *
 * Apple-touch-icon URL lives in `meta` JSON since the column
 * doesn't exist yet — keeps things forward-compatible without
 * another migration.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { siteMetaQueries } from '../../lib/db';
import { success, errors } from '../../lib/api';
import { validateUrlScheme } from '../../lib/url';

export const prerender = false;

const URL_MAX = 2048;

interface MetaJson {
  appleTouchIcon?: string;
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
    const row = await siteMetaQueries.get(env.DB, locals.workspace_id);
    if (!row) {
      return success({
        faviconUrl: null,
        appleTouchIconUrl: null,
        ogpDefaultImageUrl: null,
      });
    }
    const meta = readMeta(row.meta);
    return success({
      faviconUrl: row.favicon_url,
      appleTouchIconUrl: meta.appleTouchIcon ?? null,
      ogpDefaultImageUrl: row.ogp_default_image_url,
    });
  } catch (err) {
    console.error('GET /api/site-meta failed:', err);
    return errors.internalError('Failed to read site meta');
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

  function pickUrl(key: string): string | null | undefined {
    if (!(key in input)) return undefined;
    const value = input[key];
    if (value === null || value === '') return null;
    if (typeof value !== 'string') {
      throw new Error(`\`${key}\` must be a string or null`);
    }
    const trimmed = value.trim();
    if (trimmed.length > URL_MAX) {
      throw new Error(`\`${key}\` is too long`);
    }
    // Favicon / OGP / Apple Touch Icon URLs must be reachable by
    // crawlers and browsers — relative paths are fine (uploaded
    // assets live under the same origin) but reject any other
    // scheme so an operator can't paste `javascript:...`.
    const schemeError = validateUrlScheme(trimmed, { kind: 'relative-or-absolute' });
    if (schemeError) {
      throw new Error(`\`${key}\`: ${schemeError}`);
    }
    return trimmed;
  }

  const patch: Record<string, string | null> = {};

  try {
    const favicon = pickUrl('faviconUrl');
    const ogpDefault = pickUrl('ogpDefaultImageUrl');
    const appleTouch = pickUrl('appleTouchIconUrl');

    if (favicon !== undefined) patch.favicon_url = favicon;
    if (ogpDefault !== undefined) patch.ogp_default_image_url = ogpDefault;

    if (appleTouch !== undefined) {
      const existing = await siteMetaQueries.get(env.DB, locals.workspace_id);
      const meta = readMeta(existing?.meta ?? null);
      if (appleTouch === null) delete meta.appleTouchIcon;
      else meta.appleTouchIcon = appleTouch;
      patch.meta = JSON.stringify(meta);
    }
  } catch (err) {
    return errors.validationError(
      err instanceof Error ? err.message : String(err)
    );
  }

  try {
    const updated = await siteMetaQueries.upsert(env.DB, locals.workspace_id, patch);
    const meta = readMeta(updated.meta);
    return success({
      faviconUrl: updated.favicon_url,
      appleTouchIconUrl: meta.appleTouchIcon ?? null,
      ogpDefaultImageUrl: updated.ogp_default_image_url,
    });
  } catch (err) {
    console.error('PUT /api/site-meta failed:', err);
    return errors.internalError('Failed to update site meta');
  }
};
