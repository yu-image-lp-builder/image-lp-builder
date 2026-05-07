/**
 * Public host resolution.
 *
 * The Worker is reachable on at least two URLs at any given time:
 *
 *   - {worker-name}.{account}.workers.dev — always, free, the URL the
 *     self-hoster gets the moment they click "Deploy to Cloudflare".
 *   - lp.{self-hoster-domain}                  — once they wire a custom
 *     domain on the site-settings page (and bind it in the CF
 *     dashboard).
 *
 * Pretty much every "where do I link to / what's the canonical URL"
 * question in the codebase reduces to:
 *
 *   "Given the request that just came in and the row in site_meta,
 *    what host *should* this LP advertise?"
 *
 * Centralising the answer here keeps the rule consistent across the
 * public LP page, OGP/canonical tags, the QR / share-URL builders in
 * the admin UI, the workers.dev kill-switch redirect, and the
 * robots.txt / forced-noindex logic that ships alongside this helper.
 *
 * The rule itself is small and worth stating once:
 *
 *   - site_meta.domain set       -> lp.{domain} is canonical, regardless
 *                                   of which host the request hit.
 *   - site_meta.domain unset     -> whatever host the request hit is
 *                                   canonical (workers.dev URL stays
 *                                   indexable until the self-hoster wires
 *                                   their own domain).
 */

import type { SiteMeta } from './db';

export interface ResolvedHost {
  /** Host the LP should advertise (no port, no scheme). */
  host: string;
  /** "https:" in production, mirrors the request scheme on localhost. */
  scheme: 'http:' | 'https:';
  /** True when site_meta.domain is set and we're returning lp.{domain}. */
  isCustomDomain: boolean;
  /** True when the *request* hit a *.workers.dev host. */
  requestIsWorkersDev: boolean;
}

const WORKERS_DEV_SUFFIX = '.workers.dev';

/**
 * Decide which host the LP should canonicalise on, given the
 * incoming request URL and the site_meta row (which may be null on
 * a fresh install).
 */
export function resolvePublicHost(
  requestUrl: URL,
  siteMeta: SiteMeta | null
): ResolvedHost {
  const requestHost = requestUrl.hostname;
  const requestIsWorkersDev = requestHost.endsWith(WORKERS_DEV_SUFFIX);
  const domain = siteMeta?.domain?.trim();

  // Custom domain wired? Force lp.{domain} as the canonical host
  // even if the visitor arrived on workers.dev — that's the whole
  // point of the canonical tag, and the workers.dev kill-switch
  // builds the same target for its 301.
  if (domain) {
    return {
      host: `lp.${domain}`,
      scheme: 'https:',
      isCustomDomain: true,
      requestIsWorkersDev,
    };
  }

  // No custom domain yet. Echo whatever host the request hit so a
  // visitor on workers.dev sees a workers.dev canonical, and a
  // visitor on localhost (preview / dev) sees localhost. Localhost
  // keeps http: so dev links remain clickable; everything else is
  // https: because Workers always terminates TLS upstream.
  const isLocal =
    requestHost === 'localhost' ||
    requestHost === '127.0.0.1' ||
    requestHost.endsWith('.localhost');
  return {
    host: requestHost,
    scheme: isLocal ? (requestUrl.protocol as 'http:' | 'https:') : 'https:',
    isCustomDomain: false,
    requestIsWorkersDev,
  };
}

/**
 * Build a fully-qualified public URL for an LP slug. Wraps
 * resolvePublicHost so callers don't have to assemble the scheme /
 * host / path themselves.
 */
export function buildPublicUrl(
  resolved: ResolvedHost,
  pathname: string
): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${resolved.scheme}//${resolved.host}${path}`;
}
