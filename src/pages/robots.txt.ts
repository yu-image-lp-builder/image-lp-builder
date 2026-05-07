/**
 * /robots.txt
 *
 * Two host-aware policies, picked at request time:
 *
 *   1. Custom domain wired AND request hit a *.workers.dev host
 *      -> Disallow: / so crawlers stop pulling pages from the
 *         deprecated origin. Indexable pages are served from
 *         lp.{domain}, which already sets a self-referential
 *         canonical via PublicLayout.
 *
 *   2. Anything else (workers.dev with no custom domain yet, or the
 *      custom domain itself) -> Allow everything. Per-LP indexing
 *      decisions are made by the LpMetaPanel toggle, not robots.txt.
 *
 * Disallow alone won't drop pages that crawlers have already
 * indexed (Google keeps the URL in results without snippet) — the
 * forced <meta name=robots content=noindex> in [slug].astro covers
 * that case. Both layers ship together so the workers.dev host
 * fully drops out of search over time.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { siteMetaQueries } from '../lib/db';
import { resolvePublicHost } from '../lib/canonical';
import { resolveWorkspace } from '../lib/workspace';

export const prerender = false;

const ALLOW_ALL = 'User-agent: *\nAllow: /\n';
const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const siteMetaRow = env?.DB
    ? await siteMetaQueries.get(env.DB, resolveWorkspace())
    : null;
  const host = resolvePublicHost(url, siteMetaRow);

  const body =
    host.requestIsWorkersDev && host.isCustomDomain ? DISALLOW_ALL : ALLOW_ALL;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Crawlers refetch periodically; an hour is plenty short to
      // pick up the self-hoster flipping the domain switch without
      // hammering D1 for every robot hit.
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
