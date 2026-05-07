/**
 * Site-meta resolution
 *
 * Converts the raw site_meta row into the camelCase shape consumed
 * by PublicLayout. Apple-touch-icon URL lives in the `meta` JSON
 * blob since it has no dedicated column yet (forward-compatible
 * without migrations). Returns undefined when the row is empty so
 * callers can pass it straight through.
 */

import type { SiteMeta } from './db';

export interface ResolvedSiteMeta {
  faviconUrl?: string | null;
  appleTouchIconUrl?: string | null;
  ogpDefaultImageUrl?: string | null;
}

interface MetaShape {
  appleTouchIcon?: string;
}

export function resolveSiteMeta(
  row: SiteMeta | null
): ResolvedSiteMeta | undefined {
  if (!row) return undefined;

  let parsedMeta: MetaShape = {};
  if (row.meta) {
    try {
      const parsed = JSON.parse(row.meta) as unknown;
      if (parsed && typeof parsed === 'object') parsedMeta = parsed as MetaShape;
    } catch {
      /* ignore corrupt meta */
    }
  }

  const result: ResolvedSiteMeta = {
    faviconUrl: row.favicon_url,
    appleTouchIconUrl: parsedMeta.appleTouchIcon ?? null,
    ogpDefaultImageUrl: row.ogp_default_image_url,
  };

  const hasAny = Object.values(result).some((v) => v && v.length > 0);
  return hasAny ? result : undefined;
}
