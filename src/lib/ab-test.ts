/**
 * A/B test helpers
 *
 * A/B variants are sibling Page rows with page_type='ab_variant' and
 * parent_id pointing at the original LP. Each variant carries
 * `meta.ab.{label, weight}` as JSON.
 *
 * Distribution at /[slug] works like this:
 * 1. The parent LP is matched by slug.
 * 2. List published variants (status='published').
 * 3. If the visitor already has the cookie, serve the matching row.
 * 4. Otherwise pick weighted-random across {parent + variants}, set
 *    the cookie, and serve the chosen row.
 *
 * The cookie key is per-parent so the visitor can be in different
 * tests on different LPs simultaneously.
 */

import type { Page } from './db';

export const AB_COOKIE_PREFIX = '_lpab_';
export const AB_COOKIE_MAX_AGE_DAYS = 30;

export type AbMeta = {
  label: string;
  weight: number;
};

export interface AbCandidate {
  page: Page;
  /** 'control' for the parent, the variant id otherwise. */
  bucket: string;
  weight: number;
  label: string;
}

/**
 * Read `meta.ab` off a Page row. Falls back to a sane default for
 * the control row (which doesn't carry an ab object until you create
 * a variant).
 */
export function readAbMeta(page: Page, fallbackLabel: string): AbMeta {
  if (!page.meta) return { label: fallbackLabel, weight: 1 };
  try {
    const parsed: unknown = JSON.parse(page.meta);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'ab' in parsed &&
      typeof (parsed as { ab: unknown }).ab === 'object' &&
      (parsed as { ab: unknown }).ab !== null
    ) {
      const ab = (parsed as { ab: Record<string, unknown> }).ab;
      const label = typeof ab.label === 'string' ? ab.label : fallbackLabel;
      const weight =
        typeof ab.weight === 'number' && ab.weight >= 0 ? ab.weight : 1;
      return { label, weight };
    }
  } catch {
    // ignore
  }
  return { label: fallbackLabel, weight: 1 };
}

/**
 * Build the candidate list for a parent LP: the parent itself
 * (always included as the "control" bucket) plus published
 * variants. Variants with weight=0 or non-published status are
 * excluded.
 */
export function buildCandidates(parent: Page, variants: Page[]): AbCandidate[] {
  const list: AbCandidate[] = [];
  const parentAb = readAbMeta(parent, 'コントロール');
  if (parentAb.weight > 0) {
    list.push({
      page: parent,
      bucket: 'control',
      weight: parentAb.weight,
      label: parentAb.label,
    });
  }
  for (const v of variants) {
    if (v.status !== 'published') continue;
    const ab = readAbMeta(v, '案');
    if (ab.weight <= 0) continue;
    list.push({ page: v, bucket: v.id, weight: ab.weight, label: ab.label });
  }
  return list;
}

/**
 * Find the candidate matching the bucket id stored in the cookie.
 * Returns null if the cookie value points at a candidate that no
 * longer exists (e.g. the variant was deleted) so the caller can
 * re-pick.
 */
export function pickByBucket(
  candidates: AbCandidate[],
  bucket: string
): AbCandidate | null {
  return candidates.find((c) => c.bucket === bucket) ?? null;
}

/**
 * Weighted-random pick across candidates. Caller is responsible for
 * passing a non-empty list.
 */
export function pickWeighted(candidates: AbCandidate[]): AbCandidate {
  if (candidates.length === 0) {
    throw new Error('pickWeighted requires at least one candidate');
  }
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return candidates[0];
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

export function abCookieName(parentId: string): string {
  return `${AB_COOKIE_PREFIX}${parentId}`;
}

/**
 * Cookie attributes for the variant-choice cookie. Path '/' so it
 * sticks across all routes; SameSite=Lax to allow normal navigation
 * while still sending the cookie. Not HttpOnly because the page-side
 * dataLayer push reads it for analytics.
 */
export function abCookieAttributes(): string {
  const maxAgeSeconds = AB_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  return `Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

/**
 * Parse the variant cookie out of a Cookie header.
 */
export function readAbCookie(
  cookieHeader: string | null,
  parentId: string
): string | null {
  if (!cookieHeader) return null;
  const name = abCookieName(parentId);
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}
