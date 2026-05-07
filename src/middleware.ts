/**
 * Authentication middleware
 *
 * Runs on every request before route handlers.
 * - Authenticates admin via Google OAuth session cookie (production)
 *   or a fixed dev admin (localhost).
 * - Populates Astro.locals.user with the resolved admin row.
 * - Redirects unauthenticated /admin/* visitors to /admin/login.
 * - Returns 401 JSON for unauthenticated /api/* hits.
 *
 * Protected paths: /admin/*, /api/*
 * Public-but-under-admin: /admin/login, /admin/auth/start,
 *   /admin/auth/callback, /admin/logout (carved out so the OAuth
 *   round-trip can complete).
 * Public paths: /, /<slug> (public LPs), /go/*, /preview/*, /mcp
 */

import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { isAdminPublicPath, requiresAuth } from './lib/auth';
import { errors } from './lib/api';
import { runPendingMigrations } from './lib/migrations';
import { resolveWorkspace } from './lib/workspace';
import { siteMetaQueries } from './lib/db';
import {
  buildSessionCookie,
  generateSessionId,
  isSessionTrackedPath,
  readSessionCookie,
} from './lib/session';
import {
  readAdminSessionCookie,
  verifyAdminSession,
} from './lib/admin-session';
import { getOrCreateDevAdmin } from './lib/admin-auth';
import { isInProgress, readLock } from './lib/update-lock';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Backward-compat 301: self-hosters may have shared `/lp-*` URLs (QR
  // codes, business cards, ad campaigns) before the route prefix was
  // removed. Forward the visitor to the new path so those links
  // keep working. Runs before auth / migrations because the old paths
  // no longer exist as routes — without this short-circuit they'd
  // 404 instead.
  const legacyTarget = legacyRouteRedirect(pathname, url.search);
  if (legacyTarget) {
    return new Response(null, {
      status: 301,
      headers: { Location: legacyTarget, 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // Initialize user as null
  context.locals.user = null;
  // Resolve the workspace for this request (constant 'default' for
  // now). Both protected and public routes see a non-null value so
  // db helpers can rely on it.
  context.locals.workspace_id = resolveWorkspace();
  // Session id is populated below for public LP visits only. Other
  // paths see null so route handlers can `if (locals.session_id) ...`.
  context.locals.session_id = null;

  // Auto-apply schema migrations on the first request handled by
  // each isolate. This is what lets a non-technical self-hoster click
  // "Deploy to Cloudflare" and have a working database without ever
  // running wrangler. Memoised inside runPendingMigrations.
  if (env?.DB) {
    try {
      await runPendingMigrations(env.DB);
    } catch (err) {
      console.error('Migration check failed:', err);
      // Don't bring down the whole site over a migration error —
      // log and let the request proceed; routes that hit missing
      // tables will surface a clearer error to the operator.
    }
  }

  // workers.dev kill switch: when the self-hoster flips
  // workers_dev_disabled on, every request that landed on a
  // *.workers.dev host gets 301'd to lp.{domain}/{same path}. Public
  // LPs, /admin, /api, /go, /preview — the lot. The point is that
  // the self-hoster can decide "I'm consolidated on lp.{domain} now,
  // anyone still bookmarking the workers.dev URL should just be
  // forwarded once and never see it again." Path + query are
  // preserved so deep links don't break.
  if (env?.DB && url.hostname.endsWith('.workers.dev')) {
    try {
      const siteMeta = await siteMetaQueries.get(env.DB, context.locals.workspace_id);
      const targetDomain = siteMeta?.domain?.trim();
      if (siteMeta?.workers_dev_disabled === 1 && targetDomain) {
        return new Response(null, {
          status: 301,
          headers: {
            Location: `https://lp.${targetDomain}${pathname}${url.search}`,
            // Long-cache the redirect so repeat visits from the
            // legacy host don't keep hitting D1 just to learn the
            // same answer. Self-hosters re-enabling workers.dev will
            // see the redirect linger for an hour, which is fine.
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch (err) {
      // Don't 500 the request over a kill-switch lookup failure —
      // fall through and serve the workers.dev URL as if the toggle
      // were off. Logged for the operator to investigate.
      console.error('workers.dev kill-switch lookup failed:', err);
    }
  }

  // Skip auth for public paths — but still attach the security
  // headers below to harden every response.
  if (!requiresAuth(pathname)) {
    // Issue / refresh the session cookie on public LP visits before the
    // route handler runs, so the page can read locals.session_id and
    // record a page_view + render outbound CTAs with ?ref=.
    let issuedSessionCookie: string | null = null;
    if (isSessionTrackedPath(pathname)) {
      const existing = readSessionCookie(
        context.request.headers.get('cookie')
      );
      const sessionId = existing ?? generateSessionId();
      context.locals.session_id = sessionId;
      if (!existing) {
        const secure =
          url.hostname !== 'localhost' &&
          url.hostname !== '127.0.0.1' &&
          !url.hostname.endsWith('.localhost');
        // Promote the session cookie to a parent-domain cookie when
        // the visitor is on the self-hoster's lp.{domain} so sibling
        // sub-domains read the same identifier without a query
        // string. workers.dev hosts intentionally stay scoped: the
        // public suffix list blocks cookies on .workers.dev, and the
        // ?ref= URL param already carries the id across hops there.
        const cookieDomain = resolveSessionCookieDomain(url.hostname);
        issuedSessionCookie = buildSessionCookie(
          sessionId,
          secure,
          cookieDomain
        );
      }
    }
    const response = await next();
    if (issuedSessionCookie) {
      response.headers.append('Set-Cookie', issuedSessionCookie);
    }
    applySecurityHeaders(response);
    return response;
  }

  // Get database binding from cloudflare:workers
  if (!env?.DB) {
    // Database not available (configuration issue)
    return errors.internalError('Database not configured');
  }

  try {
    // Determine if running in development mode. Localhost = dev,
    // otherwise = production. Astro v6 + wrangler dev doesn't
    // reliably set import.meta.env.DEV, so we check the URL host.
    const isDev =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.endsWith('.localhost');

    if (isDev) {
      // Bypass OAuth entirely on localhost. Lazily creates the dev
      // admin row so a fresh database doesn't land the developer on
      // /admin/login on every cold start.
      const devAdmin = await getOrCreateDevAdmin(
        env.DB,
        context.locals.workspace_id
      );
      context.locals.user = {
        id: devAdmin.id,
        email: devAdmin.email,
        role: devAdmin.role,
        created_at: devAdmin.created_at,
        last_login_at: devAdmin.last_login_at,
      };
    } else {
      const sessionToken = readAdminSessionCookie(
        context.request.headers.get('cookie')
      );
      const found = sessionToken
        ? await verifyAdminSession(env.DB, sessionToken)
        : null;

      if (!found) {
        // Authentication failed for a protected route.
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          return errors.unauthorized();
        }
        // For admin pages, redirect to /admin/login (preserving the
        // intended destination so the user lands back where they
        // tried to go).
        const loginUrl = new URL('/admin/login', url);
        loginUrl.searchParams.set(
          'redirect_to',
          `${pathname}${url.search}`
        );
        return new Response(null, {
          status: 302,
          headers: { Location: loginUrl.toString() },
        });
      }

      context.locals.user = {
        id: found.user.id,
        email: found.user.email,
        role: found.user.role,
        created_at: found.user.created_at,
        last_login_at: found.user.last_login_at,
      };
    }
  } catch (err) {
    console.error('Authentication error:', err);
    return errors.internalError('Authentication failed');
  }

  // Self-update lock: while a /admin/update run is in progress, every
  // other /admin/* page redirects to /admin/update so the operator
  // can't edit LP content or settings mid-deploy. /api/* is left
  // alone — the polling UI on /admin/update needs to call /api/version,
  // /api/admin/update/status, and /api/admin/update/release while the
  // lock is held. /admin/update itself (and its install round-trip)
  // are exempted to avoid a redirect loop.
  if (
    env?.RATE_LIMIT &&
    (pathname === '/admin' || pathname.startsWith('/admin/')) &&
    pathname !== '/admin/update' &&
    !pathname.startsWith('/admin/update/')
  ) {
    try {
      const lock = await readLock(env.RATE_LIMIT, context.locals.workspace_id);
      if (isInProgress(lock)) {
        return new Response(null, {
          status: 302,
          headers: { Location: '/admin/update' },
        });
      }
    } catch (err) {
      // Fail open: a transient KV read error shouldn't lock the
      // operator out. The /admin/update page will read the lock
      // again and surface the right state.
      console.error('update lock check failed:', err);
    }
  }

  const response = await next();
  applySecurityHeaders(response);
  return response;
});

// Re-exported so the OAuth callback route (which has to short-circuit
// the middleware once it issues a session) can also tag its responses.
// Other modules outside this file shouldn't need to call it.
export function isAdminPublic(pathname: string): boolean {
  return isAdminPublicPath(pathname);
}

/**
 * Map old `/lp-*` paths to their post-rename equivalents. Returns the
 * full target (path + query) for a 301, or null when the request is
 * already on a current path.
 *
 * The mapping is mechanical, so it stays in middleware rather than
 * needing a route handler per legacy prefix:
 *
 *   /lp/<slug>            -> /<slug>
 *   /lp-admin             -> /admin
 *   /lp-admin/...         -> /admin/...
 *   /lp-api/...           -> /api/...
 *   /lp-c/...             -> /go/...
 *   /lp-preview/...       -> /preview/...
 *   /lp-mcp               -> /mcp
 *   /lp-mcp/...           -> /mcp/...
 *
 * `search` includes the leading `?` when present (or an empty
 * string), matching `URL#search`'s convention so the caller can
 * concatenate without conditionals.
 */
/**
 * Decide the apex to scope `image_lp_sid` to, given the request host.
 * Returns the bare apex (e.g. "example.com") to attach as
 * `Domain=.example.com`, or null when the cookie should stay
 * host-scoped — workers.dev (public suffix), localhost (no parent),
 * and IP literals all fall in the null bucket.
 *
 * The conservative rule is "two or more dot-separated labels and a
 * non-numeric TLD". That's enough for lp.example.com -> example.com
 * without dragging in country-code public suffixes (foo.co.uk would
 * incorrectly become co.uk under naïve last-two-labels). The
 * public-suffix-list would be needed for *.co.uk apex; the simple
 * rule suffices for the common gTLD case.
 */
function resolveSessionCookieDomain(hostname: string): string | null {
  if (hostname.endsWith('.workers.dev')) return null;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  ) {
    return null;
  }
  // Bare-IP guard: numeric-only labels can't be cookie domains.
  if (/^[0-9.]+$/.test(hostname)) return null;
  const labels = hostname.split('.');
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1] ?? '';
  if (tld.length < 2 || /^\d+$/.test(tld)) return null;
  return labels.slice(-2).join('.');
}

function legacyRouteRedirect(
  pathname: string,
  search: string
): string | null {
  // /lp/<slug> -> /<slug>
  if (pathname.startsWith('/lp/')) {
    return `${pathname.slice(3)}${search}`;
  }
  const prefixMap: Array<[string, string]> = [
    ['/lp-admin', '/admin'],
    ['/lp-api', '/api'],
    ['/lp-c', '/go'],
    ['/lp-preview', '/preview'],
    ['/lp-mcp', '/mcp'],
  ];
  for (const [oldPrefix, newPrefix] of prefixMap) {
    if (pathname === oldPrefix) {
      return `${newPrefix}${search}`;
    }
    if (pathname.startsWith(`${oldPrefix}/`)) {
      return `${newPrefix}${pathname.slice(oldPrefix.length)}${search}`;
    }
  }
  return null;
}

/**
 * Attach baseline security headers to every response.
 *
 * We deliberately don't ship a strict Content-Security-Policy: the
 * builder lets self-hosters paste arbitrary HTML into the tracking-tags
 * box (their own GTM / Pixel snippets), which would conflict with a
 * tight script-src list. The headers below are the "safe" subset
 * that hardens the response without breaking any existing feature.
 *
 * - X-Content-Type-Options: prevents MIME sniffing.
 * - X-Frame-Options: blocks third-party iframes (clickjacking) while
 *   still allowing same-origin (the admin preview iframe).
 * - Referrer-Policy: trims referrer for cross-origin navigation.
 * - Permissions-Policy: turns off browser APIs LPs never need.
 * - X-Image-LP-Builder-Version: identifies this response as coming from an
 *   image-lp-builder Worker. The domain settings panel pings
 *   lp.{domain} during a save and uses this header to tell apart
 *   "you wired it up correctly" from "lp.{domain} is hosted by
 *   something else entirely." Bumped together with package.json so
 *   the value also doubles as a build-version probe.
 */
function applySecurityHeaders(response: Response): void {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );
  response.headers.set('X-Image-LP-Builder-Version', IMAGE_LP_BUILDER_VERSION);
}

// Hard-coded so the middleware doesn't need to read package.json at
// request time (Workers don't ship the file in the bundle anyway).
// Bump this when cutting a release if downstream tooling cares about
// the value — the domain probe only checks for presence, not contents.
const IMAGE_LP_BUILDER_VERSION = '0.1.0';
