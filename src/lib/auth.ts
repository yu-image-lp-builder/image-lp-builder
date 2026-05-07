/**
 * Path-classification helpers for the auth middleware.
 *
 * The actual authentication mechanics — Google OAuth via the relay,
 * session cookie issuance/verification — live in `oauth-client.ts`,
 * `admin-session.ts`, and `admin-auth.ts`. This file just answers
 * "does this path require an authenticated admin session?" and
 * "is this path part of the OAuth round-trip itself?" so the
 * middleware can stay readable.
 */

/**
 * Paths that the OAuth round-trip itself uses. These sit under
 * `/admin/*` (so requiresAuth would otherwise gate them), but they
 * have to be reachable without a valid admin session — that's the
 * whole point of the login flow.
 */
const ADMIN_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/admin/login',
  '/admin/auth/start',
  '/admin/auth/callback',
  '/admin/logout',
]);

export function isAdminPublicPath(pathname: string): boolean {
  return ADMIN_PUBLIC_PATHS.has(pathname);
}

/**
 * Check if a path requires an authenticated admin session.
 * Authenticated paths: /admin/*, /api/* (with the OAuth round-trip
 * paths above carved out)
 * Public paths: /, /<slug> (public LP pages), /go/*, /preview/*, /mcp
 */
export function requiresAuth(pathname: string): boolean {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return !isAdminPublicPath(pathname);
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return true;
  }

  // MCP endpoint has its own bearer-token auth (handled in the route).
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
    return false;
  }

  if (pathname.startsWith('/preview/')) return false;
  if (pathname.startsWith('/go/')) return false;

  // Public LP pages and root
  return false;
}
