/**
 * Tracking tags resolution
 *
 * Converts the raw tracking_tags row (snake_case + nullable + JSON
 * meta blob) into the camelCase shape expected by PublicLayout.
 * Returns undefined when there's no row or no tags configured, so
 * callers can pass it through directly without extra null checks.
 */

import type { TrackingTags } from './db';

export interface ResolvedTracking {
  gtmId?: string | null;
  ga4Id?: string | null;
  clarityId?: string | null;
  metaPixelId?: string | null;
  customHead?: string | null;
}

interface MetaShape {
  customHead?: string;
}

export function resolveTracking(
  row: TrackingTags | null
): ResolvedTracking | undefined {
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

  const result: ResolvedTracking = {
    gtmId: row.gtm_id,
    ga4Id: row.ga4_id,
    clarityId: row.clarity_id,
    metaPixelId: row.meta_pixel_id,
    customHead: parsedMeta.customHead ?? null,
  };

  // If everything is empty, return undefined so PublicLayout's
  // `tracking?.gtmId` style checks short-circuit at the top level.
  const hasAny = Object.values(result).some((v) => v && v.length > 0);
  return hasAny ? result : undefined;
}
