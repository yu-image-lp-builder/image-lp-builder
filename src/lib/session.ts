/**
 * Visitor session tracking.
 *
 * The public LP route hands out a `session_id` cookie on first visit
 * so subsequent activity — page_views, CTA clicks — can be tied back
 * to the same visitor.
 *
 * Cookie attributes
 * -----------------
 * - HttpOnly: yes. Server resolves Cookie -> URL on render time, so
 *   client JS never needs to read the value.
 * - Path=/, Max-Age=1y: long-lived first-party identifier.
 * - SameSite=Lax: rules out cross-site send on third-party POSTs but
 *   still set on top-level navigations, which is what we need.
 * - Secure: production only (so localhost dev keeps working over HTTP).
 */

const COOKIE_NAME = 'image_lp_sid';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const SESSION_COOKIE_NAME = COOKIE_NAME;

/**
 * Format check: `session_` + UUID-shaped tail. Defensive — keeps a
 * malformed cookie from quietly leaking into outgoing URLs or DB rows.
 */
const SESSION_ID_PATTERN = /^session_[0-9a-fA-F-]{36}$/;

/**
 * Generate a fresh session id for a visitor on their first hit.
 */
export function generateSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

/**
 * Read the session_id from the inbound `Cookie` header. Returns null
 * if the header is absent, the cookie is missing, or the value fails
 * the format check.
 */
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.split('=');
    if (!rawName) continue;
    if (rawName.trim() !== COOKIE_NAME) continue;
    const value = rest.join('=').trim();
    if (!value) return null;
    return SESSION_ID_PATTERN.test(value) ? value : null;
  }
  return null;
}

/**
 * Build the Set-Cookie header value for the visitor's session_id.
 * `secure` should be true only on production hostnames so localhost
 * dev (which is HTTP) doesn't drop the cookie.
 *
 * `cookieDomain` is the bare apex (e.g. "example.com") to attach as
 * the Domain attribute, so the same session id is visible to sibling
 * sub-domains. Pass null on workers.dev — Cloudflare publishes that
 * suffix on the public suffix list, so browsers refuse cookies scoped
 * to `.workers.dev` — and on localhost, where there's no parent zone.
 */
export function buildSessionCookie(
  sessionId: string,
  secure: boolean,
  cookieDomain: string | null = null
): string {
  const attrs = [
    `${COOKIE_NAME}=${sessionId}`,
    `Path=/`,
    `Max-Age=${ONE_YEAR_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (cookieDomain) attrs.push(`Domain=.${cookieDomain}`);
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/**
 * Append `?ref=<sessionId>` to an outbound CTA URL. Used at LP render
 * time on `line_friend` / `custom_url` CTAs.
 *
 * Pure URL parsing — anything that isn't a parseable absolute URL is
 * passed through unchanged. Keeps protocol-relative `//host/path`,
 * mailto, tel, etc. (which the caller already filters out) safe to
 * pass in too.
 */
export function appendRefParam(rawUrl: string, sessionId: string | null): string {
  if (!sessionId) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('ref', sessionId);
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Hash a value (IP, User-Agent) to a hex SHA-256 digest. We never
 * store raw values on `sessions` rows; the hash is a stable identity
 * marker for "is this the same visitor coming back" without keeping
 * personal data around.
 */
export async function hashOpaque(value: string | null): Promise<string | null> {
  if (!value) return null;
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * System path roots reserved for non-LP routes. Anything starting with
 * one of these is *not* a public LP visit and so doesn't get a session
 * cookie. Kept in sync with the routes Astro serves out of `src/pages`
 * (admin / api / go / preview / mcp) plus the static asset prefix and
 * the legacy `/lp-*` paths still handled by the backward-compat 301s.
 */
const NON_LP_ROOTS = [
  '/admin',
  '/api',
  '/go',
  '/preview',
  '/mcp',
  '/_astro',
  '/uploads',
  '/img',
  '/404',
  '/favicon',
  '/robots',
  '/lp-admin',
  '/lp-api',
  '/lp-c',
  '/lp-preview',
  '/lp-mcp',
  '/lp/',
];

/**
 * Slug-shaped path: a single `/<word>` segment using the same character
 * set the LP slug validator enforces (lowercase, digits, hyphen). Keeps
 * the cookie issuance off URLs that obviously can't be an LP — e.g.
 * file paths with extensions, deep multi-segment URLs, etc.
 */
const SLUG_PATH_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;

/**
 * Decide whether the request is hitting a public LP page that should
 * issue / refresh the session cookie. Preview, redirect, admin, api,
 * and the click-beacon endpoint all stay out of the issuance flow:
 * preview is internal, redirects bounce to the real LP, admin/api are
 * authenticated, and the beacon already runs *because* a cookie exists.
 */
export function isSessionTrackedPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return false;
  for (const root of NON_LP_ROOTS) {
    if (pathname === root || pathname.startsWith(`${root}/`)) return false;
  }
  return SLUG_PATH_PATTERN.test(pathname);
}
