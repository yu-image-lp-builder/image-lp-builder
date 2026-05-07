/**
 * /go/track
 *
 * Public click-beacon endpoint hit by `navigator.sendBeacon` from the
 * LP rendering script when a visitor taps a CTA. The browser fires
 * the beacon synchronously with the navigation that opens the CTA's
 * destination, so the request still reaches us even though the page
 * is unloading.
 *
 * Why this lives under /go (alongside the UTM short-link redirect):
 * the path is already excluded from auth (see lib/auth.requiresAuth),
 * so adding a sibling endpoint here didn't need a middleware change.
 * Astro static routes (`track.ts`) win over dynamic ones
 * (`[shortPath].astro`), so a self-hoster's UTM short-link can never
 * shadow the beacon — the cost is that `track` is effectively a
 * reserved short_path going forward (current short-paths are random
 * 6-char strings, so collision is a non-issue in practice).
 *
 * Failure mode:
 * - Malformed JSON, missing fields, or unknown page_id all return
 *   204 No Content. We never tell the caller why a beacon dropped —
 *   the endpoint is hit by every visitor's browser, and surfacing
 *   "page X doesn't exist" or "field Y is wrong" would just hand an
 *   attacker a free probe surface.
 * - The beacon is fire-and-forget on the client side, so even a 5xx
 *   from us is invisible to the visitor's UX.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries, clickQueries } from '../../lib/db';

export const prerender = false;

/**
 * Same shape check the cookie reader uses — keeps malformed values
 * out of the clicks table.
 */
const SESSION_ID_PATTERN = /^session_[0-9a-fA-F-]{36}$/;

/**
 * Allowed link_type values. Anything else gets coerced to null
 * before the insert so D1 isn't fed unbounded user input.
 */
const LINK_TYPES = new Set([
  'line_friend',
  'custom_url',
  'tel',
  'mailto',
  'webhook',
]);

const NO_CONTENT = new Response(null, { status: 204 });

export const POST: APIRoute = async ({ request }) => {
  const db = env?.DB;
  if (!db) return NO_CONTENT;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT;
  }
  if (!body || typeof body !== 'object') return NO_CONTENT;
  const payload = body as Record<string, unknown>;

  const pageId = typeof payload.pageId === 'string' ? payload.pageId : null;
  const ctaId = typeof payload.ctaId === 'string' ? payload.ctaId : null;
  if (!pageId || !ctaId) return NO_CONTENT;

  const rawSessionId =
    typeof payload.sessionId === 'string' ? payload.sessionId : null;
  const sessionId =
    rawSessionId && SESSION_ID_PATTERN.test(rawSessionId) ? rawSessionId : null;

  const linkType =
    typeof payload.linkType === 'string' && LINK_TYPES.has(payload.linkType)
      ? payload.linkType
      : null;

  // Cap destination_url length so a hostile caller can't push huge
  // strings into the row. Anything past the cap is truncated rather
  // than rejected — clicks should still be recorded even if metadata
  // is fishy.
  const rawDestination =
    typeof payload.destinationUrl === 'string' ? payload.destinationUrl : null;
  const destinationUrl = rawDestination ? rawDestination.slice(0, 2048) : null;

  // Resolve workspace_id by looking up the page. We deliberately don't
  // trust a workspace_id from the body — the beacon is unauthenticated
  // and an attacker could otherwise tag clicks against any workspace.
  // findByIdGlobal is intentional here because the route is workspace-
  // agnostic before the lookup; the page's own column tells us which
  // workspace to attribute the click to.
  let workspaceId: string | null = null;
  try {
    const row = await db
      .prepare('SELECT workspace_id FROM pages WHERE id = ?')
      .bind(pageId)
      .first<{ workspace_id: string }>();
    workspaceId = row?.workspace_id ?? null;
  } catch (err) {
    console.error('click beacon page lookup failed:', err);
    return NO_CONTENT;
  }
  if (!workspaceId) return NO_CONTENT;
  // Reference pageQueries so the typed import is preserved for
  // page-level lookups when this handler grows.
  void pageQueries;

  try {
    await clickQueries.create(db, {
      sessionId,
      pageId,
      ctaId,
      workspaceId,
      linkType,
      destinationUrl,
    });
  } catch (err) {
    console.error('click beacon insert failed:', err);
  }

  return NO_CONTENT;
};

/**
 * GET (and any other method) is silently no-op: the static route
 * shadows /go/[shortPath] and we don't want a curious GET to leak
 * the existence of the endpoint or 405 noise into self-hoster logs.
 */
export const ALL: APIRoute = () => NO_CONTENT;
