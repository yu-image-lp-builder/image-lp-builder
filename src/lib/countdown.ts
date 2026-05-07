/**
 * Countdown deadline resolution.
 *
 * The Countdown stored in `content.promotions.countdown` carries a
 * "type" that decides what its deadline actually is:
 *
 *   - absolute:               use `deadline` as-is (everyone shares it).
 *   - per_visitor:            "duration hours since this visitor first
 *                             arrived" — needs a sticky cookie.
 *   - sync_with_unpublish:    follow the LP's `unpublish_at` so the
 *                             timer ends exactly when the LP stops
 *                             being viewable.
 *
 * The renderer (CountdownBar) only needs an absolute ISO deadline —
 * this helper computes it from the visitor request and tells the
 * caller whether to attach a Set-Cookie header for the per-visitor
 * mode.
 */

import type { Countdown } from './content';
import type { Page } from './db';

export const PER_VISITOR_COOKIE_PREFIX = '_lpcd_';
export const PER_VISITOR_COOKIE_MAX_AGE_DAYS = 365; // long enough to cover even 1-year countdowns

export interface ResolvedCountdown {
  /** Render-ready countdown with its `deadline` filled in. */
  countdown: Countdown;
  /**
   * If non-null, the route should append this `Set-Cookie` header
   * to the response so the per-visitor first-seen timestamp sticks
   * for subsequent reloads.
   */
  setCookie: string | null;
}

export function perVisitorCookieName(lpId: string): string {
  return `${PER_VISITOR_COOKIE_PREFIX}${lpId}`;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}

/**
 * Resolve a Countdown into something the renderer can consume.
 *
 * - For 'absolute' / undefined type: pass through unchanged.
 * - For 'per_visitor': read the visitor cookie; if absent, mint a
 *   first-seen timestamp + ask the caller to set the cookie. The
 *   returned countdown has a concrete `deadline` field.
 * - For 'sync_with_unpublish': use the page's unpublish_at if
 *   present; otherwise fall through to whatever `deadline` was
 *   already on the countdown (so editors can preview before they
 *   set unpublish_at).
 */
export function resolveCountdown(
  countdown: Countdown,
  page: Page,
  cookieHeader: string | null
): ResolvedCountdown {
  const type = countdown.type ?? 'absolute';

  if (type === 'per_visitor') {
    const cookieName = perVisitorCookieName(page.id);
    const existing = readCookie(cookieHeader, cookieName);
    const firstSeenMs = existing ? Number.parseInt(existing, 10) : NaN;
    const isValidExisting =
      Number.isFinite(firstSeenMs) && firstSeenMs > 0;

    const baseMs = isValidExisting ? firstSeenMs : Date.now();
    const hours =
      typeof countdown.durationHours === 'number' && countdown.durationHours > 0
        ? countdown.durationHours
        : 0;
    const deadlineMs = baseMs + hours * 60 * 60 * 1000;
    const deadline = new Date(deadlineMs).toISOString();

    const setCookie = isValidExisting
      ? null
      : `${cookieName}=${baseMs}; Path=/; Max-Age=${
          PER_VISITOR_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60
        }; SameSite=Lax`;

    return {
      countdown: { ...countdown, deadline },
      setCookie,
    };
  }

  if (type === 'sync_with_unpublish') {
    const deadline = page.unpublish_at ?? countdown.deadline ?? '';
    return {
      countdown: { ...countdown, deadline },
      setCookie: null,
    };
  }

  // 'absolute' (default) — pass through.
  return {
    countdown,
    setCookie: null,
  };
}
